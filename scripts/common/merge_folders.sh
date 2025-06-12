#!/bin/bash

# Script to recursively merge the contents of a source folder into a destination folder.
# Files in the source folder will overwrite files with the same name in the destination.
# Usage: ./merge_folders.sh --source=/path/to/folder_a --dest=/path/to/folder_b

# --- Function to display script usage ---
display_usage() {
  echo "Usage: $0 --source=<source_folder> --dest=<destination_folder>"
  echo ""
  echo "Merges contents of <source_folder> into <destination_folder> recursively."
  echo "Files existing in both will be overwritten by the source version."
  echo ""
  echo "Example:"
  echo "  $0 --source=./folder_a --dest=./folder_b"
  exit 1
}

# --- Initialize variables ---
SOURCE_FOLDER_RAW=""
DEST_FOLDER_RAW=""
SOURCE_FOLDER="" # Will store the path with guaranteed trailing slash
DEST_FOLDER=""   # Will store the path with guaranteed trailing slash

# --- Parse command-line arguments ---
for i in "$@"; do
  case $i in
    --source=*)
      SOURCE_FOLDER_RAW="${i#*=}"
      shift # past argument=value
      ;;
    --dest=*)
      DEST_FOLDER_RAW="${i#*=}"
      shift # past argument=value
      ;;
    *)
      # Unknown option
      echo "Error: Unknown option or argument: $i"
      display_usage
      ;;
  esac
done

# --- Validate arguments ---
if [ -z "$SOURCE_FOLDER_RAW" ] || [ -z "$DEST_FOLDER_RAW" ]; then
  echo "Error: Both --source and --dest arguments are required."
  display_usage
fi

if [ ! -d "$SOURCE_FOLDER_RAW" ]; then
  echo "Error: Source folder '$SOURCE_FOLDER_RAW' does not exist or is not a directory."
  exit 1
fi

# Create destination folder if it doesn't exist
if [ ! -d "$DEST_FOLDER_RAW" ]; then
  echo "Destination folder '$DEST_FOLDER_RAW' does not exist. Creating it..."
  mkdir -p "$DEST_FOLDER_RAW"
  if [ $? -ne 0 ]; then
    echo "Error: Failed to create destination folder '$DEST_FOLDER_RAW'."
    exit 1
  fi
fi

# --- Add trailing slash if not present ---
# This ensures rsync copies *contents* into the destination, not the source folder itself.
# The `printf %s` is used to prevent issues with backslash escapes or other special characters
# if the path contains them.
SOURCE_FOLDER=$(printf "%s" "$SOURCE_FOLDER_RAW" | sed 's/\/*$//')/ # Remove existing slashes, then add one
DEST_FOLDER=$(printf "%s" "$DEST_FOLDER_RAW" | sed 's/\/*$//')/   # Remove existing slashes, then add one

echo "Source (normalized): $SOURCE_FOLDER"
echo "Destination (normalized): $DEST_FOLDER"

# --- Ensure rsync is installed (it typically is on modern Linux/macOS) ---
if ! command -v rsync &> /dev/null; then
    echo "Error: 'rsync' command not found."
    echo "Please install rsync: "
    echo "  On Ubuntu: sudo apt-get update && sudo apt-get install -y rsync"
    echo "  On macOS: brew install rsync (if Homebrew is installed)"
    echo "Exiting."
    exit 1
fi

# --- Perform the merge using rsync ---
echo "Merging contents from '$SOURCE_FOLDER' into '$DEST_FOLDER'..."

# -a: archive mode (recursive, preserves symlinks, permissions, ownership, timestamps, etc.)
# -v: verbose output
# --progress: shows progress for each file
if rsync -av --progress "${SOURCE_FOLDER}" "${DEST_FOLDER}"; then
  echo "Merge completed successfully."
else
  echo "Error: rsync merge failed."
  exit 1
fi

exit 0
