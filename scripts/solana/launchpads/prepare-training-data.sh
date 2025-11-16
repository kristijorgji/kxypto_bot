#!/bin/sh

# ==============================================================================
# Script: prepare-training-data.sh
# Description:
#   This script prepares training data by organizing valid JSON result files,
#   moving invalid ones to a specified directory, and then merging the cleaned
#   data into the backtest and training folders based on the given split percentage.
#   Finally, it packages the merged training data into a ZIP archive.
#
# Usage:
#   ./prepare-training-data.sh \
#     --source-dir=<input-directory> \
#     --invalid-files-dir=<invalid-directory> \
#     --training-dir=<training-directory> \
#     --backtest-dir=<backtest-directory> \
#     --training-percentage=<number 0-100> \
#     [--keep-source] [--dry-run]
#
# Arguments:
#   --source-dir          Required. Root directory containing collected JSON data.
#   --invalid-files-dir   Required. Directory where invalid files will be moved.
#   --training-dir        Required. The destination folder where all training data (new + old) will reside.
#   --backtest-dir        Required. The destination folder where all backtest data (new + old) will reside.
#   --training-percentage Required. Percentage of files to go to training set (0-100).
#   --keep-source         Optional. If provided, the original source folder (--source-dir) will NOT be deleted.
#   --dry-run             Optional. If provided, script simulates operations without changes.
#
# Notes:
# - This script expects to be run from anywhere within the project hierarchy.
# - All paths provided as arguments (--source-dir, --invalid-files-dir, --training-dir, --backtest-dir) are expected
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
SOURCE_DIR_ARG=""
INVALID_FILES_DIR_ARG=""
TRAINING_DIR_ARG=""
BACKTEST_DIR_ARG=""
TRAINING_PERCENTAGE_ARG=""
CLEANUP_SOURCE=true
DRY_RUN=false

print_usage() {
  echo "Usage: $0 --source-dir=<path> --invalid-files-dir=<path> --training-dir=<path> --backtest-dir=<path> --training-percentage=<number 0-100> [--keep-source] [--dry-run]"
}

# --- Parse arguments ---
while [ "$#" -gt 0 ]; do
  case "$1" in
    --source-dir=*) SOURCE_DIR_ARG="${1#*=}" ;;
    --invalid-files-dir=*) INVALID_FILES_DIR_ARG="${1#*=}" ;;
    --training-dir=*) TRAINING_DIR_ARG="${1#*=}" ;;
    --backtest-dir=*) BACKTEST_DIR_ARG="${1#*=}" ;;
    --training-percentage=*) TRAINING_PERCENTAGE_ARG="${1#*=}" ;;
    --keep-source) CLEANUP_SOURCE=false ;;
    --dry-run) DRY_RUN=true ;;
    *)
      echo "Error: Unknown option or invalid format: $1"
      print_usage
      exit 1
      ;;
  esac
  shift
done

# --- Validate required arguments ---
if [ -z "$SOURCE_DIR_ARG" ] || [ -z "$INVALID_FILES_DIR_ARG" ] || [ -z "$TRAINING_DIR_ARG" ] || [ -z "$BACKTEST_DIR_ARG" ] || [ -z "$TRAINING_PERCENTAGE_ARG" ]; then
  echo "Error: --source-dir, --invalid-files-dir, --training-dir, --backtest-dir, and --training-percentage are required."
  print_usage
  exit 1
fi

# --- Validate training percentage is a number between 0 and 100 ---
if ! echo "$TRAINING_PERCENTAGE_ARG" | grep -Eq '^[0-9]+$' || [ "$TRAINING_PERCENTAGE_ARG" -lt 0 ] || [ "$TRAINING_PERCENTAGE_ARG" -gt 100 ]; then
  echo "Error: --training-percentage must be an integer between 0 and 100."
  exit 1
fi

# Construct full paths for directories based on PROJECT_ROOT
# This ensures that even if the script is run from a subfolder,
# these paths resolve correctly relative to the project root.
FULL_SOURCE_DIR_ARG="${PROJECT_ROOT}/${SOURCE_DIR_ARG}"
FULL_INVALID_FILES_DIR_ARG="${PROJECT_ROOT}/${INVALID_FILES_DIR_ARG}"
FULL_TRAINING_DIR_ARG="${PROJECT_ROOT}/${TRAINING_DIR_ARG}"
FULL_BACKTEST_DIR_ARG="${PROJECT_ROOT}/${BACKTEST_DIR_ARG}"

if [ ! -d "$FULL_SOURCE_DIR_ARG" ]; then
  echo "Error: Input path '$FULL_SOURCE_DIR_ARG' (derived from '$SOURCE_DIR_ARG') is not a valid directory."
  exit 1
fi

# --- Ensure all required directories exist ---
mkdir -p "$FULL_INVALID_FILES_DIR_ARG" || { echo "❌ Error: Failed to create invalid files directory '$FULL_INVALID_FILES_DIR_ARG'."; exit 1; }
mkdir -p "$FULL_TRAINING_DIR_ARG" || { echo "❌ Error: Failed to create training directory '$FULL_TRAINING_DIR_ARG'."; exit 1; }
mkdir -p "$FULL_BACKTEST_DIR_ARG" || { echo "❌ Error: Failed to create backtest directory '$FULL_BACKTEST_DIR_ARG'."; exit 1; }

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

  args=(
    src/scripts/pumpfun/organize-stats.ts
    --path="$SOURCE_DIR_ARG"
  )

  if [ "$DRY_RUN" = true ]; then
    args+=(--dry-run)
  fi

  yarn run:script "${args[@]}" || { echo "❌ Error: 'organize-stats.ts' script failed."; exit 1; }
)

echo "--- Step 2: Validating backtest files and extracting invalid ones ---"
(
  cd "$PROJECT_ROOT" || { echo "❌ Error: Could not change to project root '$PROJECT_ROOT'."; exit 1; }

  args=(
    src/scripts/pumpfun/validate-backtest-files.ts
    --config="src/scripts/pumpfun/config/validate-backtest-files.defaults.json"
    --path="$SOURCE_DIR_ARG"
  )

  if [ "$DRY_RUN" = false ]; then
    args+=(--extractTo="$INVALID_FILES_DIR_ARG")
  else
    args+=(--extractTo="")
  fi

  yarn run:script "${args[@]}" || { echo "❌ Error: 'validate-backtest-files.ts' script failed."; exit 1; }
)

echo "--- Step 3: Merging cleaned data into the destination folders for training and backtest ---"
(
  cd "$PROJECT_ROOT" || { echo "❌ Error: Could not change to project root '$PROJECT_ROOT'."; exit 1; }

  args=(
    src/scripts/data/split-dataset.ts
    --source-dir="$FULL_SOURCE_DIR_ARG"
    --training-dir="$FULL_TRAINING_DIR_ARG"
    --backtest-dir="$FULL_BACKTEST_DIR_ARG"
    --training-percentage="$TRAINING_PERCENTAGE_ARG"
  )

  if [ "$DRY_RUN" = true ]; then
    args+=(--dry-run)
  fi

  yarn run:script "${args[@]}" || { echo "❌ Error: 'split-dataset.ts' script failed."; exit 1; }
)

echo "✅ Data from '$FULL_SOURCE_DIR_ARG' split successfully."

if [ "$DRY_RUN" = true ]; then
  echo "⚠️ Dry run enabled — skipping creation of training ZIP package."
  exit 0
fi

echo "--- Step 4: Packaging MERGED data into a ZIP archive ---"
zip_name="training-$(date +"%d_%B_%Y_%H_%M").zip"
ABSOLUTE_ZIP_PATH="${PROJECT_ROOT}/${zip_name}"

sleepSeconds=5
echo "Sleeping ${sleepSeconds} seconds to wait for the file system to actualize..."
sleep "${sleepSeconds}"

echo "Zipping the merged data from '$FULL_TRAINING_DIR_ARG' into '${ABSOLUTE_ZIP_PATH}'..."

cd "$FULL_TRAINING_DIR_ARG" || { echo "❌ Error: Could not access training directory."; exit 1; }

if zip -r "${ABSOLUTE_ZIP_PATH}" .; then
  echo "✅ Zip file '${ABSOLUTE_ZIP_PATH}' created successfully."
else
  echo "❌ Error: Failed to create zip archive '${ABSOLUTE_ZIP_PATH}'."
  exit 1
fi

echo "--- Step 5: Verifying ZIP integrity ---"

FOLDER_COUNT=$(find "$FULL_TRAINING_DIR_ARG" -type f -name '*.json' | wc -l | tr -d ' ')
ZIP_COUNT=$(zipinfo -1 "${ABSOLUTE_ZIP_PATH}" | grep '\.json$' | wc -l | tr -d ' ')

echo "Folder file count: $FOLDER_COUNT"
echo "Zip file count:    $ZIP_COUNT"

if [ "$FOLDER_COUNT" -ne "$ZIP_COUNT" ]; then
  echo "❌ Error: File count mismatch! ZIP may be incomplete."
  exit 1
else
  echo "✅ ZIP integrity verified: all files included."
fi

# --- Final Cleanup Step (with safety and user control) ---
if [ "$CLEANUP_SOURCE" = true ]; then
  echo ""
  echo "--- Finalizing: Deleting original source folder ---"
  echo "Deleting: ${FULL_SOURCE_DIR_ARG}"

  # Add a check to ensure the directory is not the root or an empty string for safety
  # This prevents accidental deletion of critical directories.
  if [ -z "$FULL_SOURCE_DIR_ARG" ] || [ "$FULL_SOURCE_DIR_ARG" = "/" ] || [ "$FULL_SOURCE_DIR_ARG" = "${PROJECT_ROOT}" ]; then
    echo "❌ Error: Refusing to delete critical or empty path: '$FULL_SOURCE_DIR_ARG'."
    echo "Please inspect the script logic or disable cleanup with --keep-source."
    exit 1 # Exit with error because a dangerous operation was prevented
  fi

  if rm -rf "${FULL_SOURCE_DIR_ARG}"; then
    echo "✅ Original source folder '${FULL_SOURCE_DIR_ARG}' deleted successfully."
  else
    echo "❌ Error: Failed to delete original source folder '${FULL_SOURCE_DIR_ARG}'."
    # Decide if script should exit here or continue. Often, deletion failure means something is wrong.
    exit 1
  fi
else
  echo ""
  echo "--- Finalizing: Skipping source folder deletion ---"
  echo "Note: Original source folder '${FULL_SOURCE_DIR_ARG}' has been kept as requested (--keep-source)."
fi

echo ""

echo "--- Script finished successfully ---"
exit 0
