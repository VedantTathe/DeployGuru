import { LLMOptions } from "../../index.js";

import OpenAI from "./OpenAI.js";

class Lemonade extends OpenAI {
  static providerName = "lemonade";
  static defaultOptions: Partial<LLMOptions> = {
    apiBase: "http://localhost:8080/api/v1/",
  };
}

export default Lemonade;
