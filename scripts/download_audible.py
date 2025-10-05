#!/usr/bin/env python3
"""Download Audible library export as CSV using the `audible` API wrapper."""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import getpass
import json
from pathlib import Path
from typing import Iterator

import audible

STATUS_PRIORITY = [
    ('FINISHED', 'Finished'),
    ('IN_PROGRESS', 'In progress'),
    ('NOT_STARTED', 'Not started'),
    ('UNSTARTED', 'Not started')
]

AUTH_DIR = Path('.auth')
AUTH_FILE = AUTH_DIR / 'audible_credentials.json'


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Download Audible library export")
  parser.add_argument('--output', '-o', default='downloads', help='Directory for CSV output (default: ./downloads)')
  parser.add_argument('--locale', default='us', help='Audible marketplace locale (default: us)')
  parser.add_argument('--email', help='Amazon login email (optional, will prompt if missing)')
  parser.add_argument('--password', help='Amazon password (optional, will prompt if missing)')
  return parser.parse_args()


def ensure_auth(locale: str, email: str | None, password: str | None) -> audible.Authenticator:
  AUTH_DIR.mkdir(parents=True, exist_ok=True)
  if AUTH_FILE.exists():
      return audible.Authenticator.from_file(AUTH_FILE)

  email = email or input('Amazon email: ').strip()
  password = password or getpass.getpass('Amazon password: ')

  def otp_callback() -> str:
      return input('Enter Amazon OTP (if prompted): ').strip()

  auth = audible.Authenticator.from_login(
      username=email,
      password=password,
      locale=locale,
      otp_callback=otp_callback
  )
  auth.to_file(AUTH_FILE)
  print(f"Saved credentials to {AUTH_FILE}")
  return auth


def fetch_library(
    auth: audible.Authenticator,
    page_size: int = 1000,
    *,
    response_groups: str = 'product_desc,product_attrs,contributors,series',
    **extra_params
) -> list[dict]:
  records: list[dict] = []
  with audible.Client(auth) as client:
      page = 1
      while True:
          params = {
              'page': page,
              'num_results': page_size,
              'response_groups': response_groups,
              **extra_params
          }
          payload = client.get('library', params=params)
          items = payload.get('items') or payload.get('products') or []
          if not items:
              break
          records.extend(items)

          total_pages = payload.get('total_pages') or payload.get('totalPages')
          if total_pages is not None and page >= int(total_pages):
              break
          if len(items) < page_size:
              break
          page += 1
  return records


def build_listening_status_map(auth: audible.Authenticator) -> dict[str, str]:
  """Return preferred listening status per ASIN using Audible filters."""
  status_by_asin: dict[str, str] = {}

  for api_value, label in STATUS_PRIORITY:
      for item in fetch_library(auth, listening_status=api_value, response_groups='product_attrs'):
          asin = (item.get('asin') or item.get('product_id') or '').strip()
          if not asin:
              continue
          if asin in status_by_asin:
              continue
          status_by_asin[asin] = label

  return status_by_asin


def normalize_item(item: dict, status_override: str | None = None) -> dict:
  title = item.get('title') or item.get('product_title') or ''

  authors_data = item.get('authors') or item.get('contributors') or []
  if isinstance(authors_data, dict):
      authors_data = [authors_data]
  if not isinstance(authors_data, (list, tuple)):
      authors_data = []
  authors = ', '.join((author or {}).get('name', '') for author in authors_data if author)

  asin = item.get('asin') or item.get('product_id') or ''
  purchase_date = item.get('purchase_date') or item.get('date_added') or ''
  raw_status = item.get('status') or item.get('status_badge', {}).get('label', '')
  if status_override:
      status = status_override
  elif isinstance(raw_status, str) and raw_status.strip().lower() != 'active':
      status = raw_status
  else:
      status = 'Not started'

  series_entries = item.get('series') or []
  if isinstance(series_entries, dict):
      series_entries = [series_entries]
  first_series = series_entries[0] if series_entries else {}
  series_title = (first_series.get('title') or '').strip()
  series_sequence = (first_series.get('sequence') or '').strip()
  series_parent_asin = (first_series.get('asin') or '').strip()

  return {
      'Title': title,
      'Author(s)': authors,
      'Listening Status': status,
      'Purchase Date': purchase_date,
      'Product ID': asin,
      'Series Title': series_title,
      'Series Sequence': series_sequence,
      'Series Parent ASIN': series_parent_asin
  }


def write_csv(rows: list[dict], output_dir: Path, timestamp: str) -> Path:
  output_dir.mkdir(parents=True, exist_ok=True)
  file_path = output_dir / f'audible-library-{timestamp}.csv'

  with file_path.open('w', newline='', encoding='utf-8') as handle:
      writer = csv.DictWriter(
          handle,
          fieldnames=[
              'Title',
              'Author(s)',
              'Listening Status',
              'Purchase Date',
              'Product ID',
              'Series Title',
              'Series Sequence',
              'Series Parent ASIN'
          ]
      )
      writer.writeheader()
      writer.writerows(rows)

  return file_path


def chunked(items: list[str], size: int) -> Iterator[list[str]]:
  for index in range(0, len(items), size):
      yield items[index:index + size]


def sequence_sort_key(raw: str | None) -> tuple[int, str]:
  if not raw:
      return (9999, '')
  raw = raw.strip()
  try:
      value = float(raw.split('-')[0])
      return (int(value * 100), raw)
  except ValueError:
      return (9998, raw)


def collect_series_catalog(
    auth: audible.Authenticator,
    series_lookup: dict[str, dict],
    library_asins: set[str]
) -> dict[str, dict]:
  if not series_lookup:
      return {}

  catalog: dict[str, dict] = {}

  with audible.Client(auth) as client:
      for parent_asin, data in series_lookup.items():
          if not parent_asin:
              continue

          try:
              product = client.get(
                  'catalog/products',
                  params={'asins': parent_asin, 'response_groups': 'relationships'}
              )
          except Exception as error:  # pragma: no cover
              print(f'Failed to fetch series relationships for {parent_asin}: {error}')
              continue

          payload = (product.get('products') or [{}])[0]
          relationships = payload.get('relationships') or []
          children = [
              rel for rel in relationships
              if rel.get('relationship_type') == 'series' and rel.get('relationship_to_product') == 'child'
          ]

          seq_by_asin = {
              (rel.get('asin') or '').strip(): (rel.get('sequence') or '').strip()
              for rel in children
              if rel.get('asin')
          }

          child_asins = [asin for asin in seq_by_asin.keys() if asin]
          volumes: list[dict] = []

          for batch in chunked(child_asins, 50):
              if not batch:
                  continue
              try:
                  details = client.get(
                      'catalog/products',
                      params={'asins': ','.join(batch), 'response_groups': 'product_desc'}
                  )
              except Exception as error:  # pragma: no cover
                  print(f'Failed to fetch catalog details for {batch}: {error}')
                  continue

              for product_entry in details.get('products') or []:
                  asin = (product_entry.get('asin') or '').strip()
                  if not asin:
                      continue
                  volumes.append({
                      'asin': asin,
                      'title': (product_entry.get('title') or '').strip(),
                      'sequence': seq_by_asin.get(asin, ''),
                      'owned': asin in library_asins
                  })

          if not volumes:
              volumes = [
                  {
                      'asin': entry.get('asin', ''),
                      'title': entry.get('title', ''),
                      'sequence': entry.get('sequence', ''),
                      'owned': entry.get('asin', '') in library_asins
                  }
                  for entry in data.get('libraryVolumes', [])
              ]

          volumes.sort(key=lambda item: (sequence_sort_key(item.get('sequence')), item.get('title')))

          catalog[parent_asin] = {
              'parentAsin': parent_asin,
              'title': data.get('title', ''),
              'libraryVolumes': data.get('libraryVolumes', []),
              'volumes': volumes
          }

  return catalog


def write_series_catalog(series_catalog: dict[str, dict], output_dir: Path, timestamp: str) -> Path | None:
  if not series_catalog:
      return None

  output_dir.mkdir(parents=True, exist_ok=True)
  file_path = output_dir / f'audible-series-metadata-{timestamp}.json'

  payload = {
      'generatedAt': timestamp,
      'seriesCount': len(series_catalog),
      'series': list(series_catalog.values())
  }

  with file_path.open('w', encoding='utf-8') as handle:
      json.dump(payload, handle, ensure_ascii=False, indent=2)

  return file_path


def main() -> None:
  args = parse_args()
  auth = ensure_auth(args.locale, args.email, args.password)

  print('Fetching Audible library...')
  status_map = build_listening_status_map(auth)
  print(f'Resolved listening status for {len(status_map)} items')

  library_items = fetch_library(auth)
  print(f'Fetched {len(library_items)} library items')

  rows: list[dict] = []
  library_asins: set[str] = set()
  series_lookup: dict[str, dict] = {}

  for item in library_items:
      asin = (item.get('asin') or item.get('product_id') or '').strip()
      if asin:
          library_asins.add(asin)
      status_override = status_map.get(asin) if asin else None
      row = normalize_item(item, status_override=status_override)
      rows.append(row)

      series_entries = item.get('series') or []
      if isinstance(series_entries, dict):
          series_entries = [series_entries]
      if series_entries:
          primary = series_entries[0]
          parent_asin = (primary.get('asin') or '').strip()
          if parent_asin:
              series_entry = series_lookup.setdefault(
                  parent_asin,
                  {
                      'title': (primary.get('title') or '').strip(),
                      'libraryVolumes': []
                  }
              )
              series_entry['libraryVolumes'].append({
                  'asin': asin,
                  'title': row['Title'],
                  'sequence': (primary.get('sequence') or '').strip()
              })

  series_catalog = collect_series_catalog(auth, series_lookup, library_asins)

  timestamp = dt.datetime.now(dt.UTC).strftime('%Y-%m-%dT%H-%M-%SZ')
  output_dir = Path(args.output)
  file_path = write_csv(rows, output_dir, timestamp)
  print(f'Export written to {file_path}')

  series_path = write_series_catalog(series_catalog, output_dir, timestamp)
  if series_path:
      print(f'Series metadata written to {series_path}')
  else:
      print('No series metadata to write')


if __name__ == '__main__':
  try:
      main()
  except Exception as err:  # pragma: no cover
      print(f'Error: {err}')
      raise
