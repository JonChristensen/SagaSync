#!/usr/bin/env python3
"""Download Audible library export as CSV using the `audible` API wrapper."""
from __future__ import annotations

import argparse
import csv
import datetime as dt
import getpass
from pathlib import Path
from typing import Iterator

import audible

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


def fetch_library(auth: audible.Authenticator, page_size: int = 100) -> Iterator[dict]:
  with audible.Client(auth) as client:
      page = 1
      while True:
          payload = client.get(
              'library',
              params={
                  'page': page,
                  'num_results': page_size,
                  'response_groups': 'product_desc,product_attrs,contributors,series'
              }
          )
          items = payload.get('items') or payload.get('products') or []
          if not items:
              break
          for item in items:
              yield item

          total_pages = payload.get('total_pages') or payload.get('totalPages')
          if total_pages is not None and page >= int(total_pages):
              break
          page += 1


def normalize_item(item: dict) -> dict:
  title = item.get('title') or item.get('product_title') or ''

  authors_data = item.get('authors') or item.get('contributors') or []
  if isinstance(authors_data, dict):
      authors_data = [authors_data]
  if not isinstance(authors_data, (list, tuple)):
      authors_data = []
  authors = ', '.join((author or {}).get('name', '') for author in authors_data if author)

  asin = item.get('asin') or item.get('product_id') or ''
  purchase_date = item.get('purchase_date') or item.get('date_added') or ''
  status = item.get('status') or item.get('status_badge', {}).get('label', '')

  return {
      'Title': title,
      'Author(s)': authors,
      'Listening Status': status,
      'Purchase Date': purchase_date,
      'Product ID': asin
  }


def write_csv(rows: list[dict], output_dir: Path) -> Path:
  output_dir.mkdir(parents=True, exist_ok=True)
  timestamp = dt.datetime.utcnow().strftime('%Y-%m-%dT%H-%M-%SZ')
  file_path = output_dir / f'audible-library-{timestamp}.csv'

  with file_path.open('w', newline='', encoding='utf-8') as handle:
      writer = csv.DictWriter(
          handle,
          fieldnames=['Title', 'Author(s)', 'Listening Status', 'Purchase Date', 'Product ID']
      )
      writer.writeheader()
      writer.writerows(rows)

  return file_path


def main() -> None:
  args = parse_args()
  auth = ensure_auth(args.locale, args.email, args.password)

  print('Fetching Audible library...')
  rows = [normalize_item(item) for item in fetch_library(auth)]
  print(f'Fetched {len(rows)} items')

  output_dir = Path(args.output)
  file_path = write_csv(rows, output_dir)
  print(f'Export written to {file_path}')


if __name__ == '__main__':
  try:
      main()
  except Exception as err:  # pragma: no cover
      print(f'Error: {err}')
      raise
