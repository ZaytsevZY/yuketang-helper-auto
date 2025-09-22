/**
 * Intercepts WebSocket messages and forwards them to the helper.
 */
export class MyWebSocket extends WebSocket {
  static original = WebSocket;
  static handlers = [];

  static addHandler(handler) {
    this.handlers.push(handler);
  }

  constructor(url, protocols) {
    super(url, protocols);
    const parsed = new URL(url, location.href);
    for (const handler of this.constructor.handlers) {
      handler(this, parsed);
    }
  }

  intercept(callback) {
    this.send = (data) => {
      try {
        callback(JSON.parse(data));
      } finally {
        return super.send(data);
      }
    };
  }

  listen(callback) {
    this.addEventListener("message", (evt) => {
      callback(JSON.parse(evt.data));
    });
  }
}

/**
 * Intercepts XMLHttpRequests and forwards them to the helper.
 */
export class MyXMLHttpRequest extends XMLHttpRequest {
  static original = XMLHttpRequest;
  static handlers = [];

  static addHandler(handler) {
    this.handlers.push(handler);
  }

  open(method, url, async) {
    const parsed = new URL(url, location.href);
    for (const handler of this.constructor.handlers) {
      handler(this, method, parsed);
    }
    return super.open(method, url, async);
  }

  intercept(callback) {
    let payload;
    this.send = (body) => {
      payload = body;
      return super.send(body);
    };
    this.addEventListener("load", () => {
      callback(JSON.parse(this.responseText), payload);
    });
  }
}
