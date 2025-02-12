# development-tricks

# Table of Contents

1. [Defining Types: Grouping values from json responses](#defining-types-grouping-values-from-json-responses)
2. [Manual APM (Application performance monitoring)](#manual-apm-application-performance-monitoring)

# Defining Types: Grouping values from json responses

If you have one JSON response from a provider and want to find out all the possible
values of a key, you can use `jq`

Example:

```shell
cd __tests/data/fixtures/providers/moralis/solana
jq '.result | map(.exchangeName) | unique' get-token-swaps-response.json
```

will result in

```json
[
  "Meteora DLMM",
  "Orca Whirlpool",
  "Raydium CLMM",
  "Raydium CPMM"
]

```

If you want the values in a typescript union format can execute:

```shell
jq -r '[.result[].exchangeName] | unique | map("'"'"'" + . + "'"'"'") | join(" | ")' get-token-swaps-response.json
```

it will give

```text
'Meteora DLMM' | 'Orca Whirlpool' | 'Raydium CLMM' | 'Raydium CPMM'
```

# Manual APM (Application performance monitoring)

We can calculate function and segment execution times using our custom apm.

The data are stored in a database.

We can query the statistics for every transaction name:

```mysql
WITH Ordered AS (
    SELECT
        name,
        execution_time_ns,
        ROW_NUMBER() OVER (PARTITION BY name ORDER BY execution_time_ns) AS row_num,
        COUNT(*) OVER (PARTITION BY name) AS total_count
    FROM crypto_bot.apm
)
SELECT
    name,
    MIN(execution_time_ns) AS min_time_ns,
    MAX(execution_time_ns) AS max_time_ns,
    AVG(execution_time_ns) AS avg_time_ns,
    (SELECT execution_time_ns FROM Ordered o2
     WHERE o2.name = Ordered.name
       AND o2.row_num = FLOOR(o2.total_count * 0.5) + 1
    ) AS median_time_ns
FROM Ordered
GROUP BY name;
```

You can use these data afterward

1. to find and understand bottlenecks that need to be improved
2. to generate random "real" sleep times for the simulated functions and API calls. Check `computeSimulatedLatencyNs` function.
