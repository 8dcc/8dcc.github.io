#!/usr/bin/env python3
#
# Copyright 2026 8dcc. All Rights Reserved.
#
# This file is part of 8dcc's blog.
#
# This program is free software: you can redistribute it and/or modify it under
# the terms of the GNU General Public License as published by the Free Software
# Foundation, either version 3 of the License, or (at your option) any later
# version.
#
# This program is distributed in the hope that it will be useful, but WITHOUT
# ANY WARRANTY; without even the implied warranty of MERCHANTABILITY or FITNESS
# FOR A PARTICULAR PURPOSE.  See the GNU General Public License for more
# details.
#
# You should have received a copy of the GNU General Public License along with
# this program.  If not, see <https://www.gnu.org/licenses/>.

import re
import sys
import argparse
from pathlib import Path

PATTERN = re.compile(
    r'font-family: &quot;Courier New&quot;(?!, monospace)'
)
REPLACEMENT = 'font-family: &quot;Courier New&quot;, monospace'


def patch_file(path):
    """
    Replace unguarded "Courier New" font-family declarations in the
    specified SVG file with a version that includes monospace as fallback.
    Returns True if the file was modified, False otherwise.
    """
    original = path.read_text(encoding='utf-8')
    patched = PATTERN.sub(REPLACEMENT, original)
    if patched == original:
        return False
    path.write_text(patched, encoding='utf-8')
    return True


def main():
    parser = argparse.ArgumentParser(
        description='Add monospace fallback to Courier New font-family '
                    'declarations in SVG files.')
    parser.add_argument('directory',
                        help='Root directory to search recursively')
    args = parser.parse_args()

    root = Path(args.directory)
    if not root.is_dir():
        print(f'error: {root} is not a directory', file=sys.stderr)
        sys.exit(1)

    patched_count = 0
    for svg in sorted(root.rglob('*.svg')):
        if patch_file(svg):
            print(f'patched: {svg}')
            patched_count += 1

    if (patched_count > 0):
        print()
    print(f'{patched_count} file(s) patched.')


if __name__ == '__main__':
    main()
