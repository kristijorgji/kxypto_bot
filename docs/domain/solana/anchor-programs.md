# Executing anchor programs via TS

Example getting bondingCurve from the pumpfun program:

https://solana.stackexchange.com/a/18013/34703

If you have old IDL (Interface Description Language) from older anchor version, you can convert it to a new one first

Make sure to have `anchor` CLI installed first.

```shell
anchor idl convert pump_idl.json > pump_idl_new.json
```

Then create a type file using below command in cli

```shell
anchor idl type --out idl_type.ts pump_idl_new.json
```

```typescript

import {Pump} from "./idl_type.js";

const program = new Program(IDL as Pump, provider);

```
