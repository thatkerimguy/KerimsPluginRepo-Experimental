// Lets Node run the plugin's TypeScript as is: its imports have no extension
// ("./queue"), which Node's ESM resolver doesn't add by itself.
import { register } from "node:module";

register("./resolve.mjs", import.meta.url);
