#!/usr/bin/env bash
set -euo pipefail

# Official release and published checksum, verified against Alibaba Cloud's
# https://www.alibabacloud.com/help/en/oss/developer-reference/ossutil-overview/
destination="${1:?Pass an empty temporary installation directory}"
mkdir -p "$destination"
archive="$destination/ossutil-2.4.0-linux-amd64.zip"
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 --retry 3 \
  https://gosspublic.alicdn.com/ossutil/v2/2.4.0/ossutil-2.4.0-linux-amd64.zip --output "$archive"
echo "85edf66b2fb7238f5c7e25cab820cf29312319fe4935b7c86a6b8485eb434f3c  $archive" | sha256sum --check --strict
unzip -q "$archive" -d "$destination"
binary="$destination/ossutil-2.4.0-linux-amd64/ossutil"
chmod 755 "$binary"
"$binary" api put-object --help > "$destination/put-object-help.txt"
for option in --body --content-type --cache-control; do
  grep --fixed-strings --quiet -- "$option" "$destination/put-object-help.txt"
done
echo 'Official ossutil checksum and required PutObject options verified.'
