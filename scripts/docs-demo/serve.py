# Serves the current folder at http://127.0.0.1:8799 for the browser-mode app, which fetches the demo from another
# origin (so with CORS). For screenshots.mjs.
import http.server


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        super().end_headers()


http.server.ThreadingHTTPServer(("127.0.0.1", 8799), Handler).serve_forever()
