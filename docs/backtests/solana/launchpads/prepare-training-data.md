## How to Prepare Training Data

Training data is used to train machine learning models such as XGBoost, GRU, etc.

This guide explains how to use the collected coin results located by default in the relative directory  
`./data/pumpfun-stats/tmp` to prepare a zip archive containing only valid and properly organized results.

> **Note:** All paths mentioned are relative to the project root directory.  
> Commands should be executed from the project root as well.

### Data Location

By default, all collected coin results are stored under:  
`./data/pumpfun-stats/tmp`

### Verify and Cleanup

Before proceeding, verify the number of JSON files grouped by extension in the data path, and remove any unrelated
files:

```sh
path=data/pumpfun-stats/tmp
find $path -type f | awk -F. '/\./ {ext[$NF]++} END {for (e in ext) print e, ext[e]}' | sort
````

### Preparing The Data

To prepare your training data, run the `prepare-training-data.sh` script.

This comprehensive script automates several essential steps:

- **Organizes** your raw JSON result files for consistency and easy processing.
- **Identifies and moves** any invalid data files to a specified separate directory for further inspection or cleanup.
- **Splits and merges** the validated data into two distinct sets — **training** and **backtest** — based on the
  provided training percentage. This ensures your dataset is properly partitioned for model development and evaluation.
- **Creates a ZIP archive** of the **merged training data only**, providing a convenient snapshot of the current
  training dataset for sharing or backup.
- By default, the script **deletes the original source folder** to free up space and avoid confusion. If you want to
  keep the original data intact for review or other purposes, use the `--keep-source` flag when running the script.

**Usage Example:**

```shell
./scripts/solana/launchpads/prepare-training-data.sh \
  --source-dir=data/pumpfun-stats/tmp \
  --invalid-files-dir=data/invalid-pumpfun-stats \
  --training-dir=data/training_data/solana/pumpfun \
  --backtest-dir=data/pumpfun-stats/backtest \
  --training-percentage=50 \
  --keep-source \ # (Optional) Prevent deletion of the original source folder
  --dry-run # (Optional) Run the script in simulation mode without making any changes
```
