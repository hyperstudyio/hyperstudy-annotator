# Serves out/ (next to this file, wherever it is started from) at http://127.0.0.1:8799 for the browser-mode app,
# which fetches the demo from another origin, so with CORS: only out/, since any page open in the browser could read
# what is served. For screenshots.mjs.
import functools
import http.server
from pathlib import Path


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


OUT = Path(__file__).resolve().parent / "out"
http.server.ThreadingHTTPServer(("127.0.0.1", 8799), functools.partial(Handler, directory=str(OUT))).serve_forever()
