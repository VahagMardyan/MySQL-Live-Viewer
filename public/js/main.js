import { App } from "./App.js";
import { ApiClient } from "./api/ApiClient.js";
import { Preferences } from "./core/Preferences.js";

const $ = (id) => document.getElementById(id);

new App({ api: new ApiClient("/api"), preferences: new Preferences() })
  .mount({
    db: $("db"),
    status: $("status"),
    dot: $("dot"),
    pageSize: $("pageSize"),
    interval: $("interval"),
    pause: $("pause"),
    tabs: $("tabs"),
    views: $("views"),
    info: $("info"),
    pager: $("pager"),
    notice: $("notice"),
    groupbar: $("groupbar"),
    view: $("view"),
  })
  .start();
