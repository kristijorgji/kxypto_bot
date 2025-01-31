# development-tricks

## Defining Types: Grouping values from json responses

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
