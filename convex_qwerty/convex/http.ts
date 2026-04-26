import { httpRouter } from "convex/server";
import {
    insertFile,
    setFileStatus,
    bulkInsertChunks,
    getChunksByIds,
    appendMessage,
} from "./httpActions";

const http = httpRouter();

http.route({ path: "/qwerty/files/insert",    method: "POST", handler: insertFile });
http.route({ path: "/qwerty/files/status",    method: "POST", handler: setFileStatus });
http.route({ path: "/qwerty/chunks/bulkInsert", method: "POST", handler: bulkInsertChunks });
http.route({ path: "/qwerty/chunks/getByIds",   method: "POST", handler: getChunksByIds });
http.route({ path: "/qwerty/messages/append",  method: "POST", handler: appendMessage });

export default http;
