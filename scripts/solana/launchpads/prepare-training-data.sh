#!/bin/sh

# ==============================================================================
# Script: prepare-training-data.sh
# Description: This script prepares training data by organizing valid JSON result
#              files, moving invalid ones to a specified directory, and then
#              merging this cleaned data into a final destination folder.
#              Finally, it packages the merged dataset into a ZIP archive.
#
# Usage:
#   ./prepare-training-data.sh \
#     --path=<input-directory> \
#     --invalidFilesPath=<invalid-directory> \
#     --dest=<destination-directory> \
#     [--keep-source]
#
# Arguments:
#   --path                Required. The root directory containing collected JSON data.
#   --invalidFilesPath    Required. Where to move invalid files.
#   --dest                Required. The destination folder where all training data (new + old) will reside.
#   --keep-source         Optional. If provided, the original source folder (--path) will NOT be deleted.
#
# Example:
#   ./prepare-training-data.sh \
#     --path=data/pumpfun-stats/tmp \
#     --invalidFilesPath=data/invalid-pumpfun-stats \
#     --dest=data/training_data/solana/pumpfun \
#     --keep-source
#
# Notes:
# - This script expects to be run from anywhere within the project hierarchy.
# - All paths provided as arguments (--path, --invalidFilesPath, --dest) are expected
#   to be relative to the project root.
# - The project root is identified by the presence of a '.root' marker file.
# - For a complete walkthrough and additional details, refer to:
#   docs/backtests/solana/launchpads/prepare-training-data.md
# ==============================================================================

set -eu # Exit immediately if a command exits with a non-zero status or an unset variable is used.

# --- Find the path to this script's directory for sourcing utilities ---
_THIS_SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" >/dev/null 2>&1 && pwd -P)"

# --- Source the common utilities script from 'scripts/common/utils.sh' ---
. "${_THIS_SCRIPT_DIR}/../../../scripts/common/utils.sh" || { echo "❌ Error: Could not source common utilities script. Ensure 'utils.sh' is at 'scripts/common/' relative to project root." ; exit 1; }

# --- Find the project root ---
PROJECT_ROOT=$(find_project_root) || exit 1 # Exit if root not found
echo "Project root identified: $PROJECT_ROOT"

# --- Initialize arguments ---
PATH_ARG=""
INVALID_FILES_PATH_ARG=""
DEST_ARG=""
CLEANUP_SOURCE=true # Default: delete source folder

MERGE_SCRIPT="${PROJECT_ROOT}/scripts/common/merge_folders.sh"

# --- Parse arguments ---
while [ "$#" -gt 0 ]; do
  case "$1" in
    --path=*)
      PATH_ARG="${1#*=}"
      shift
      ;;
    --invalidFilesPath=*)
      INVALID_FILES_PATH_ARG="${1#*=}"
      shift
      ;;
    --dest=*)
      DEST_ARG="${1#*=}"
      shift
      ;;
    --keep-source) # New flag to prevent source folder deletion
      CLEANUP_SOURCE=false
      shift
      ;;
    *)
      echo "Error: Unknown option or invalid format: $1"
      echo "Usage: $0 --path=<path> --invalidFilesPath=<path> --dest=<path> [--keep-source]"
      exit 1
      ;;
  esac
done

# --- Validate required arguments ---
if [ -z "$PATH_ARG" ] || [ -z "$INVALID_FILES_PATH_ARG" ] || [ -z "$DEST_ARG" ]; then
  echo "Error: All --path, --invalidFilesPath, and --dest arguments are required."
  echo "Usage: $0 --path=<path> --invalidFilesPath=<path> --dest=<path> [--keep-source]"
  exit 1
fi

# Construct full paths for directories based on PROJECT_ROOT
# This ensures that even if the script is run from a subfolder,
# these paths resolve correctly relative to the project root.
FULL_PATH_ARG="${PROJECT_ROOT}/${PATH_ARG}"
FULL_INVALID_FILES_PATH_ARG="${PROJECT_ROOT}/${INVALID_FILES_PATH_ARG}"
FULL_DEST_ARG="${PROJECT_ROOT}/${DEST_ARG}"

if [ ! -d "$FULL_PATH_ARG" ]; then
  echo "Error: Input path '$FULL_PATH_ARG' (derived from '$PATH_ARG') is not a valid directory."
  exit 1
fi

# Ensure invalid files directory exists
mkdir -p "$FULL_INVALID_FILES_PATH_ARG" || { echo "❌ Error: Failed to create invalid files directory '$FULL_INVALID_FILES_PATH_ARG'."; exit 1; }

# Ensure destination directory exists (or create it)
mkdir -p "$FULL_DEST_ARG" || { echo "❌ Error: Failed to create destination directory '$FULL_DEST_ARG'."; exit 1; }

# --- Command Existence & Installation Checks (using `command_exists` from utils.sh) ---

# --- Check and install 'zip' ---
if ! command_exists zip; then
  echo "⚠️ 'zip' command not found. Attempting to install..."
  UNAME_OUT="$(uname)"

  if [ "$UNAME_OUT" = "Darwin" ]; then # macOS
    if command_exists brew; then
      brew install zip || { echo "❌ Error: Failed to install 'zip' via Homebrew."; exit 1; }
      echo "✅ 'zip' installed successfully via Homebrew."
    else
      echo "❌ Error: Homebrew not found. Please install Homebrew (https://brew.sh/) or 'zip' manually."
      exit 1
    fi
  elif [ -f /etc/os-release ]; then # Linux (Ubuntu/Debian)
    ID=""
    if grep -q "^ID=ubuntu" /etc/os-release; then
        ID="ubuntu"
    elif grep -q "^ID=debian" /etc/os-release; then
        ID="debian"
    fi

    if [ "$ID" = "ubuntu" ] || [ "$ID" = "debian" ]; then
      sudo apt-get update && sudo apt-get install -y zip || { echo "❌ Error: Failed to install 'zip' via apt-get."; exit 1; }
      echo "✅ 'zip' installed successfully via apt-get."
    else
      echo "❌ Error: Unsupported Linux distribution. Please install 'zip' manually."
      exit 1
    fi
  else
    echo "❌ Error: Unsupported operating system. Please install 'zip' manually."
    exit 1
  fi
fi

# --- Main Workflow: Organize, Validate, Merge, then Zip ---

echo "--- Step 1: Organizing JSON files ---"
(
  cd "$PROJECT_ROOT" || { echo "❌ Error: Could not change to project root '$PROJECT_ROOT'."; exit 1; }
  yarn run:script src/scripts/pumpfun/organize-stats.ts --path="$PATH_ARG" || { echo "❌ Error: 'organize-stats.ts' script failed."; exit 1; }
)

echo "--- Step 2: Validating backtest files and extracting invalid ones ---"
(
  cd "$PROJECT_ROOT" || { echo "❌ Error: Could not change to project root '$PROJECT_ROOT'."; exit 1; }
  yarn run:script src/scripts/pumpfun/validate-backtest-files.ts --path="$PATH_ARG" --extractTo="$INVALID_FILES_PATH_ARG" || { echo "❌ Error: 'validate-backtest-files.ts' script failed."; exit 1; }
)

echo "--- Step 3: Merging cleaned data into the destination folder ---"
if [ ! -f "$MERGE_SCRIPT" ]; then
    echo "❌ Error: Merge script not found at '$MERGE_SCRIPT'. Please ensure it exists and is executable."
    exit 1
fi
echo "Calling merge script: '$MERGE_SCRIPT --source=$FULL_PATH_ARG --dest=$FULL_DEST_ARG'"
"$MERGE_SCRIPT" --source="$FULL_PATH_ARG" --dest="$FULL_DEST_ARG" || { echo "❌ Error: Data merge failed via external script." ; exit 1; }
echo "✅ Data from '$FULL_PATH_ARG' merged successfully into '$FULL_DEST_ARG'."


echo "--- Step 4: Packaging MERGED data into a ZIP archive ---"
zip_name="training-$(date +"%d_%B_%Y_%H_%M").zip"
ABSOLUTE_ZIP_PATH="$(pwd)/${zip_name}"

echo "Zipping the merged data from '$FULL_DEST_ARG' into '${ABSOLUTE_ZIP_PATH}'..."

# Change to the target directory ($FULL_DEST_ARG) for zipping its *contents*
# The 'cd' command is run in a subshell, so it doesn't affect the main script's CWD.
# The 'zip' command then zips the current directory ('.') into the specified ABSOLUTE_ZIP_PATH.
# '>/dev/null 2>&1' is added to silence the 'cd' command's potential output or errors,
# and to ensure only the 'zip' command's success/failure determines the 'if' condition.
if (cd "$FULL_DEST_ARG" >/dev/null 2>&1 && zip -r "${ABSOLUTE_ZIP_PATH}" .); then
  echo "✅ Zip file '${ABSOLUTE_ZIP_PATH}' created successfully."
else
  echo "❌ Error: Failed to create zip archive '${ABSOLUTE_ZIP_PATH}'."
  exit 1
fi

# --- Final Cleanup Step (with safety and user control) ---
if [ "$CLEANUP_SOURCE" = true ]; then
  echo ""
  echo "--- Finalizing: Deleting original source folder ---"
  echo "Deleting: ${FULL_PATH_ARG}"

  # Add a check to ensure the directory is not the root or an empty string for safety
  # This prevents accidental deletion of critical directories.
  if [ -z "$FULL_PATH_ARG" ] || [ "$FULL_PATH_ARG" = "/" ] || [ "$FULL_PATH_ARG" = "${PROJECT_ROOT}" ]; then
    echo "❌ Error: Refusing to delete critical or empty path: '$FULL_PATH_ARG'."
    echo "Please inspect the script logic or disable cleanup with --keep-source."
    exit 1 # Exit with error because a dangerous operation was prevented
  fi

  if rm -rf "${FULL_PATH_ARG}"; then
    echo "✅ Original source folder '${FULL_PATH_ARG}' deleted successfully."
  else
    echo "❌ Error: Failed to delete original source folder '${FULL_PATH_ARG}'."
    # Decide if script should exit here or continue. Often, deletion failure means something is wrong.
    exit 1
  fi
else
  echo ""
  echo "--- Finalizing: Skipping source folder deletion ---"
  echo "Note: Original source folder '${FULL_PATH_ARG}' has been kept as requested (--keep-source)."
fi

echo ""

echo "--- Script finished successfully ---"
exit 0
