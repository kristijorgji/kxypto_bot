#!/bin/sh
# This script is intended to be sourced, not executed directly.
# Functions defined here become available in the sourcing script.

# Function to find the project root by looking for a .root marker file
find_project_root() {
  local current_dir # Declare local variable
  current_dir="$(pwd -P)" # Get current absolute path (resolve symlinks)

  while [ "$current_dir" != "/" ] && [ "$current_dir" != "." ]; do
    if [ -f "$current_dir/.root" ]; then
      printf "%s" "$current_dir"
      return 0
    fi
    current_dir="$(dirname "$current_dir")"
  done

  echo "Error: .root marker file not found in any parent directory." >&2
  echo "Please ensure a '.root' file exists in your project's root folder." >&2
  return 1
}

# Function to check if a command exists
command_exists() {
  command -v "$1" >/dev/null 2>&1
}

if [ "$0" = "$BASH_SOURCE" ]; then echo "This script is meant to be sourced"; exit 1; fi
