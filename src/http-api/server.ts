import configureExpressApp from './configureExpressApp';

const port = parseInt(process.env.APP_PORT as string);

configureExpressApp()
    .listen(port)
    .setTimeout(10 * 60 * 1000);

console.log(`Listening on port ${port}`);
