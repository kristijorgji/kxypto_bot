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

This powerful script automates several crucial steps:

* **Organizes** your raw JSON result files.
* **Identifies and moves** any invalid data files to a designated separate directory.
* **Merges** the newly processed and validated data into your existing training data collection, located in the
  specified destination directory. This ensures your dataset is always up-to-date and complete.
* **Creates a ZIP archive** of the *merged* training data, providing a convenient snapshot of your current dataset.
* By default, the script **deletes the original source folder** (`--path`). If you need to retain the original data for
  inspection or other uses, simply add the `--keep-source` flag when running the script.

**Usage Example:**

```shell
./scripts/solana/launchpads/prepare-training-data.sh \
  --path=data/pumpfun-stats/tmp \
  --invalidFilesPath=data/invalid-pumpfun-stats \
  --dest=data/training_data/solana/pumpfun \
  --keep-source # (Optional) Add this flag to keep the original source folder
```
