#!/bin/sh
set -e

outputDir="./src/protos/generated"

rm -rf $outputDir/*

if [ ! -d "$outputDir" ]; then
  echo "Destination folder '$outputDir' does not exist. Creating it..."
  mkdir -p "$outputDir"
  if [ $? -ne 0 ]; then
    echo "Error: Failed to create destination folder '$outputDir'."
    exit 1
  fi
fi


# Generate TypeScript types from .proto files.
# The option "snakeToCamel=false" keeps field names exactly as defined in the .proto file
# (e.g. "exit_code" instead of converting to "exitCode").
protoc \
    --plugin="./node_modules/.bin/protoc-gen-ts_proto" \
    --ts_proto_out="$outputDir" \
    --ts_proto_opt=esModuleInterop=true \
    --ts_proto_opt=snakeToCamel=false \
    --ts_proto_opt=typePrefix=Proto \
    -I "./src/protos" \
    ./src/protos/*.proto

echo "Types were generated successfully"
