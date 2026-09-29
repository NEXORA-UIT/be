import { app } from './app.js';
import { appConfig } from './config/app.config.js';

app.listen(appConfig.port, () => {
  console.log("SV CHAY ROIO DCM M");
});
