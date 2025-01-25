# ts-boilerplate

This boilerplate provides you a fully working out of the box project using
* typescript
* jest
* lint and fix tools using my personal best standards from https://www.npmjs.com/package/@kristijorgji/eslint-config-typescript
* fully debug compatible

# Getting started
Use this project as `template` project from github or clone it.

run `yarn install` or `npm install`

run `yarn start` or `npm run start` and you will see the example console.log output.

Now you are ready to modify `src/index.ts` to have the logic you want plus add remove more code as you wish.

Have fun

# Environmental variables

This project uses also `dotenv` so you can create `.env` file and specify your variables and will be used by the index file

# Package.json scripts
you can run them by `yarn commmand` or `npm run command`


| Command | Description                                                                                                          |
|---------|----------------------------------------------------------------------------------------------------------------------|
| test    | run jest tests under __tests__ directory                                                                             |
| start   | starts the code using ts-node, also can be used under intellJ under debug mode to develop and debug at the same time |
| compile | compiles the code so you can execute it as plain node if don't want to use start command                             |
| lint    | lints your code and fails if some issue is found                                                                     |
| fix     | makes changes to your code to fix the styling issues and whatever other fixable code standard                        |
