(function(exports) {
var define, requireModule;

(function() {
  var registry = {}, seen = {};

  define = function(name, deps, callback) {
    registry[name] = { deps: deps, callback: callback };
  };

  requireModule = function(name) {
    if (seen[name]) { return seen[name]; }
    seen[name] = {};

    var mod = registry[name],
        deps = mod.deps,
        callback = mod.callback,
        reified = [],
        exports;

    for (var i=0, l=deps.length; i<l; i++) {
      if (deps[i] === 'exports') {
        reified.push(exports = {});
      } else {
        reified.push(requireModule(deps[i]));
      }
    }

    var value = callback.apply(this, reified);
    return seen[name] = exports || value;
  };
})();
define("rsvp",
  ["exports"],
  function(__exports__) {
    "use strict";
    var config = {};

    var browserGlobal = (typeof window !== 'undefined') ? window : {};

    var MutationObserver = browserGlobal.MutationObserver || browserGlobal.WebKitMutationObserver;
    var RSVP;

    if (typeof process !== 'undefined' &&
      {}.toString.call(process) === '[object process]') {
      config.async = function(callback, binding) {
        process.nextTick(function() {
          callback.call(binding);
        });
      };
    } else if (MutationObserver) {
      var queue = [];

      var observer = new MutationObserver(function() {
        var toProcess = queue.slice();
        queue = [];

        toProcess.forEach(function(tuple) {
          var callback = tuple[0], binding = tuple[1];
          callback.call(binding);
        });
      });

      var element = document.createElement('div');
      observer.observe(element, { attributes: true });

      // Chrome Memory Leak: https://bugs.webkit.org/show_bug.cgi?id=93661
      window.addEventListener('unload', function(){
        observer.disconnect();
        observer = null;
      });

      config.async = function(callback, binding) {
        queue.push([callback, binding]);
        element.setAttribute('drainQueue', 'drainQueue');
      };
    } else {
      config.async = function(callback, binding) {
        setTimeout(function() {
          callback.call(binding);
        }, 1);
      };
    }

    var Event = function(type, options) {
      this.type = type;

      for (var option in options) {
        if (!options.hasOwnProperty(option)) { continue; }

        this[option] = options[option];
      }
    };

    var indexOf = function(callbacks, callback) {
      for (var i=0, l=callbacks.length; i<l; i++) {
        if (callbacks[i][0] === callback) { return i; }
      }

      return -1;
    };

    var callbacksFor = function(object) {
      var callbacks = object._promiseCallbacks;

      if (!callbacks) {
        callbacks = object._promiseCallbacks = {};
      }

      return callbacks;
    };

    var EventTarget = {
      mixin: function(object) {
        object.on = this.on;
        object.off = this.off;
        object.trigger = this.trigger;
        return object;
      },

      on: function(eventNames, callback, binding) {
        var allCallbacks = callbacksFor(this), callbacks, eventName;
        eventNames = eventNames.split(/\s+/);
        binding = binding || this;

        while (eventName = eventNames.shift()) {
          callbacks = allCallbacks[eventName];

          if (!callbacks) {
            callbacks = allCallbacks[eventName] = [];
          }

          if (indexOf(callbacks, callback) === -1) {
            callbacks.push([callback, binding]);
          }
        }
      },

      off: function(eventNames, callback) {
        var allCallbacks = callbacksFor(this), callbacks, eventName, index;
        eventNames = eventNames.split(/\s+/);

        while (eventName = eventNames.shift()) {
          if (!callback) {
            allCallbacks[eventName] = [];
            continue;
          }

          callbacks = allCallbacks[eventName];

          index = indexOf(callbacks, callback);

          if (index !== -1) { callbacks.splice(index, 1); }
        }
      },

      trigger: function(eventName, options) {
        var allCallbacks = callbacksFor(this),
            callbacks, callbackTuple, callback, binding, event;

        if (callbacks = allCallbacks[eventName]) {
          // Don't cache the callbacks.length since it may grow
          for (var i=0; i<callbacks.length; i++) {
            callbackTuple = callbacks[i];
            callback = callbackTuple[0];
            binding = callbackTuple[1];

            if (typeof options !== 'object') {
              options = { detail: options };
            }

            event = new Event(eventName, options);
            callback.call(binding, event);
          }
        }
      }
    };

    var Promise = function() {
      this.on('promise:resolved', function(event) {
        this.trigger('success', { detail: event.detail });
      }, this);

      this.on('promise:failed', function(event) {
        this.trigger('error', { detail: event.detail });
      }, this);
    };

    var noop = function() {};

    var invokeCallback = function(type, promise, callback, event) {
      var hasCallback = typeof callback === 'function',
          value, error, succeeded, failed;

      if (hasCallback) {
        try {
          value = callback(event.detail);
          succeeded = true;
        } catch(e) {
          failed = true;
          error = e;
        }
      } else {
        value = event.detail;
        succeeded = true;
      }

      if (value && typeof value.then === 'function') {
        value.then(function(value) {
          promise.resolve(value);
        }, function(error) {
          promise.reject(error);
        });
      } else if (hasCallback && succeeded) {
        promise.resolve(value);
      } else if (failed) {
        promise.reject(error);
      } else {
        promise[type](value);
      }
    };

    Promise.prototype = {
      then: function(done, fail) {
        var thenPromise = new Promise();

        if (this.isResolved) {
          config.async(function() {
            invokeCallback('resolve', thenPromise, done, { detail: this.resolvedValue });
          }, this);
        }

        if (this.isRejected) {
          config.async(function() {
            invokeCallback('reject', thenPromise, fail, { detail: this.rejectedValue });
          }, this);
        }

        this.on('promise:resolved', function(event) {
          invokeCallback('resolve', thenPromise, done, event);
        });

        this.on('promise:failed', function(event) {
          invokeCallback('reject', thenPromise, fail, event);
        });

        return thenPromise;
      },

      resolve: function(value) {
        resolve(this, value);

        this.resolve = noop;
        this.reject = noop;
      },

      reject: function(value) {
        reject(this, value);

        this.resolve = noop;
        this.reject = noop;
      }
    };

    function resolve(promise, value) {
      config.async(function() {
        promise.trigger('promise:resolved', { detail: value });
        promise.isResolved = true;
        promise.resolvedValue = value;
      });
    }

    function reject(promise, value) {
      config.async(function() {
        promise.trigger('promise:failed', { detail: value });
        promise.isRejected = true;
        promise.rejectedValue = value;
      });
    }

    function all(promises) {
      var i, results = [];
      var allPromise = new Promise();
      var remaining = promises.length;

      if (remaining === 0) {
        allPromise.resolve([]);
      }

      var resolver = function(index) {
        return function(value) {
          resolve(index, value);
        };
      };

      var resolve = function(index, value) {
        results[index] = value;
        if (--remaining === 0) {
          allPromise.resolve(results);
        }
      };

      var reject = function(error) {
        allPromise.reject(error);
      };

      for (i = 0; i < remaining; i++) {
        promises[i].then(resolver(i), reject);
      }
      return allPromise;
    }

    EventTarget.mixin(Promise.prototype);

    function configure(name, value) {
      config[name] = value;
    }

    __exports__.Promise = Promise;
    __exports__.Event = Event;
    __exports__.EventTarget = EventTarget;
    __exports__.all = all;
    __exports__.configure = configure;
  });
define("oasis",
  ["rsvp"],
  function(RSVP) {
    "use strict";

    function assert(assertion, string) {
      if (!assertion) {
        throw new Error(string);
      }
    }

    function verifySandbox() {
      var iframe = document.createElement('iframe');

      iframe.sandbox = 'allow-scripts';
      assert(iframe.getAttribute('sandbox') === 'allow-scripts', "The current version of Oasis requires Sandboxed iframes, which are not supported on your current platform. See http://caniuse.com/#feat=iframe-sandbox");

      assert(typeof MessageChannel !== 'undefined', "The current version of Oasis requires MessageChannel, which is not supported on your current platform. A near-future version of Oasis will polyfill MessageChannel using the postMessage API");
    }

    //verifySandbox();

    var Oasis = {};

    // ADAPTERS

    function generateSrc(sandboxURL, dependencyURLs) {
      function importScripts() {}

      dependencyURLs = dependencyURLs || [];

      var link = document.createElement("a");
      link.href = "!";
      var base = link.href.slice(0, -1);

      var src = "data:text/html,<!doctype html>";
      src += "<base href='" + base + "'>";
      src += "<script src='oasis.js'><" + "/script>";
      src += "<script>" + importScripts.toString() + "<" + "/script>";
      dependencyURLs.forEach(function(url) {
        src += "<script src='" + url + "'><" + "/script>";
      });
      src += "<script src='" + sandboxURL + "'><" + "/script>";
      return src;
    }

    Oasis.adapters = {};

    var iframeAdapter = Oasis.adapters.iframe = {
      initializeSandbox: function(sandbox) {
        var options = sandbox.options,
            iframe = document.createElement('iframe');

        iframe.sandbox = 'allow-scripts';
        iframe.seamless = true;
        iframe.src = generateSrc(options.url, sandbox.dependencies);

        // rendering-specific code
        if (options.width) {
          iframe.width = options.width;
        } else if (options.height) {
          iframe.height = options.height;
        }

        iframe.addEventListener('load', function() {
          sandbox.didInitializeSandbox();
        });

        sandbox.el = iframe;
      },

      createChannel: function(sandbox) {
        var channel = new PostMessageMessageChannel();
        channel.port1.start();
        return channel;
      },

      environmentPort: function(sandbox, channel) {
        return channel.port1;
      },

      sandboxPort: function(sandbox, channel) {
        return channel.port2;
      },

      proxyPort: function(sandbox, port) {
        return port;
      },

      connectPorts: function(sandbox, ports) {
        var rawPorts = ports.map(function(port) { return port.port; });
        sandbox.el.contentWindow.postMessage({ isOasisInitialization: true, capabilities: sandbox.capabilities }, rawPorts, '*');
      },

      startSandbox: function(sandbox) {
        document.head.appendChild(sandbox.el);
      },

      terminateSandbox: function(sandbox) {
        var el = sandbox.el;

        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      },

      // SANDBOX HOOKS
      connectSandbox: function(ports) {
        window.addEventListener('message', function(event) {
          if (!event.data.isOasisInitialization) { return; }

          var capabilities = event.data.capabilities, eventPorts = event.ports;

          capabilities.forEach(function(capability, i) {
            var handler = handlers[capability],
                port = new PostMessagePort(eventPorts[i]);

            if (handler) {
              handler.setupCapability(port);
              port.start();
            }

            ports[capability] = port;
          });
        });
      }
    };

    function generateWebWorkerURL(sandboxURL, dependencyURLs) {
      var link = document.createElement("a");
      link.href = "!";
      var base = link.href.slice(0, -1);

      dependencyURLs = dependencyURLs || [];

      function importScriptsString(url) {
        return "importScripts('" + base + url + "'); ";
      }

      var src = importScriptsString("oasis.js");
      dependencyURLs.forEach(function(url) {
        src += importScriptsString(url);
      });
      src += importScriptsString(sandboxURL);

      var blob = new Blob([src], {type: "application/javascript"});
      return URL.createObjectURL(blob);
    }

    Oasis.adapters.webworker = {
      initializeSandbox: function(sandbox) {
        var url = generateWebWorkerURL(sandbox.options.url, sandbox.dependencies);
        var worker = new Worker(url);
        sandbox.worker = worker;
        setTimeout(function() {
          sandbox.didInitializeSandbox();
        });
      },

      createChannel: function(sandbox) {
        var channel = new PostMessageMessageChannel();
        channel.port1.start();
        return channel;
      },

      environmentPort: function(sandbox, channel) {
        return channel.port1;
      },

      sandboxPort: function(sandbox, channel) {
        return channel.port2;
      },

      proxyPort: function(sandbox, port) {
        return port;
      },

      connectPorts: function(sandbox, ports) {
        var rawPorts = ports.map(function(port) { return port.port; });
        sandbox.worker.postMessage({ isOasisInitialization: true, capabilities: sandbox.capabilities }, rawPorts, '*');
      },

      startSandbox: function(sandbox) { },

      terminateSandbox: function(sandbox) {
        sandbox.worker.terminate();
      },

      connectSandbox: function(ports) {
        self.addEventListener('message', function(event) {
          if (!event.data.isOasisInitialization) { return; }

          var capabilities = event.data.capabilities, eventPorts = event.ports;

          capabilities.forEach(function(capability, i) {
            var handler = handlers[capability],
                port = new PostMessagePort(eventPorts[i]);

            if (handler) {
              handler.setupCapability(port);
              port.start();
            }

            ports[capability] = port;
          });
        });
      }
    };

    // SANDBOXES

    var OasisSandbox = function(options) {
      this.connections = {};

      // Generic capabilities code
      var pkg = packages[options.url];

      var capabilities = options.capabilities;
      if (!capabilities) {
        assert(pkg, "You are trying to create a sandbox from an unregistered URL without providing capabilities. Please use Oasis.register to register your package or pass a list of capabilities to createSandbox.");
        capabilities = pkg.capabilities;
      }

      pkg = pkg || {};

      this.dependencies = options.dependencies || pkg.dependencies;

      this.adapter = options.adapter || iframeAdapter;
      this.capabilities = capabilities;
      this.options = options;

      this.adapter.initializeSandbox(this);
    };

    OasisSandbox.prototype = {
      connect: function(capability) {
        var promise = new RSVP.Promise();
        var connections;

        connections = this.connections[capability];
        connections = connections || [];

        connections.push(promise);
        this.connections[capability] = connections;

        return promise;
      },

      triggerConnect: function(capability, port) {
        var connections = this.connections[capability];

        if (connections) {
          connections.forEach(function(connection) {
            connection.resolve(port);
          });

          this.connections[capability] = [];
        }
      },

      didInitializeSandbox: function() {
        // Generic services code
        var options = this.options;
        var services = options.services || {};
        var ports = [], channels = this.channels = {};

        this.capabilities.forEach(function(capability) {
          var service = services[capability],
              channel, port;

          // If an existing port is provided, just
          // pass it along to the new sandbox.

          // TODO: This should probably be an OasisPort if possible
          if (service instanceof OasisPort) {
            port = this.adapter.proxyPort(this, service);
          } else {
            channel = channels[capability] = this.adapter.createChannel();

            var environmentPort = this.adapter.environmentPort(this, channel),
                sandboxPort = this.adapter.sandboxPort(this, channel);

            if (service) {
              /*jshint newcap:false*/
              // Generic
              service = new service(environmentPort, this);
              service.initialize(environmentPort, capability);
            }

            // Generic
            this.triggerConnect(capability, environmentPort);
            // Law of Demeter violation
            port = sandboxPort;
          }

          ports.push(port);
        }, this);

        this.adapter.connectPorts(this, ports);
      },

      start: function(options) {
        this.adapter.startSandbox(this, options);
      },

      terminate: function() {
        this.adapter.terminateSandbox(this);
      }
    };

    /**
      This is the entry point that allows the containing environment to create a
      child sandbox.

      Options:

      * `capabilities`: an array of registered services
      * `url`: a registered URL to a JavaScript file that will initialize the
        sandbox in the sandboxed environment
      * `adapter`: a reference to an adapter that will handle the lifecycle
        of the sandbox. Right now, there are iframe and web worker adapters.

      @param {Object} options
    */
    Oasis.createSandbox = function(options) {
      return new OasisSandbox(options);
    };

    /**
      This is a base class that services and consumers can subclass to easily
      implement a number of events and requests at once.

      Example:

          var MetadataService = Oasis.Service.extend({
            initialize: function() {
              this.send('data', this.sandbox.data);
            },

            events: {
              changed: function(data) {
                this.sandbox.data = data;
              }
            },

            requests: {
              valueForProperty: function(name, promise) {
                promise.resolve(this.sandbox.data[name]);
              }
            }
          });

      In the above example, the metadata service implements the Service
      API using `initialize`, `events` and `requests`.

      Both services (implemented in the containing environment) and
      consumers (implemented in the sandbox) use the same API for
      registering events and requests.

      In the containing environment, a service is registered in the
      `createSandbox` method. In the sandbox, a consumer is registered
      using `Oasis.connect`.

      ### `initialize`

      Oasis calls the `initialize` method once the other side of the
      connection has initialized the connection.

      This method is useful to pass initial data back to the other side
      of the connection. You can also set up events or requests manually,
      but you will usually want to use the `events` and `requests` sections
      for events and requests.

      ### `events`

      The `events` object is a list of event names and associated callbacks.
      Oasis will automatically set up listeners for each named event, and
      trigger the callback with the data provided by the other side of the
      connection.

      ### `requests`

      The `requests` object is a list of request names and associated
      callbacks. Oasis will automatically set up listeners for requests
      made by the other side of the connection, and trigger the callback
      with the request information as well as a promise that you should
      use to fulfill the request.

      Once you have the information requested, you should call
      `promise.resolve` with the response data.

      @constructor
      @param {OasisPort} port
      @param {OasisSandbox} sandbox in the containing environment, the
        OasisSandbox that this service is connected to.
    */
    Oasis.Service = function(port, sandbox) {
      var service = this, prop, callback;

      this.sandbox = sandbox;
      this.port = port;

      function xform(callback) {
        return function() {
          callback.apply(service, arguments);
        };
      }

      for (prop in this.events) {
        callback = this.events[prop];
        port.on(prop, xform(callback));
      }

      for (prop in this.requests) {
        callback = this.requests[prop];
        port.onRequest(prop, xform(callback));
      }
    };

    Oasis.Service.prototype = {
      /**
        This hook is called when the connection is established. When
        `initialized` is called, it is safe to register listeners and
        send data to the other side.

        The implementation of Oasis makes it impossible for messages
        to get dropped on the floor due to timing issues.

        @param {OasisPort} port the port to the other side of the connection
        @param {String} name the name of the service
      */
      initialize: function() {},

      /**
        This method can be used to send events to the other side of the
        connection.

        @param {String} eventName the name of the event to send to the
          other side of the connection
        @param {Structured} data an additional piece of data to include
          as the data for the event.
      */
      send: function() {
        return this.port.send.apply(this.port, arguments);
      },

      /**
        This method can be used to request data from the other side of
        the connection.

        @param {String} requestName the name of the request to send to
          the other side of the connection.
        @return {Promise} a promise that will be resolved by the other
          side of the connection. Use `.then` to wait for the resolution.
      */
      request: function() {
        return this.port.request.apply(this.port, arguments);
      }
    };

    Oasis.Service.extend = function(object) {
      function Service() {
        Oasis.Service.apply(this, arguments);
      }

      var ServiceProto = Service.prototype = Object.create(Oasis.Service.prototype);

      for (var prop in object) {
        ServiceProto[prop] = object[prop];
      }

      return Service;
    };

    Oasis.Consumer = Oasis.Service;

    // SUBCLASSING

    function extend(parent, object) {
      function OasisObject() {
        parent.apply(this, arguments);
        if (this.initialize) {
          this.initialize.apply(this, arguments);
        }
      }

      OasisObject.prototype = Object.create(parent.prototype);

      for (var prop in object) {
        if (!object.hasOwnProperty(prop)) { continue; }
        OasisObject.prototype[prop] = object[prop];
      }

      return OasisObject;
    }

    // PORTS

    var packages, requestId, oasisId;
    Oasis.reset = function() {
      packages = {};
      requestId = 0;
      oasisId = 'oasis' + (+new Date());
    };
    Oasis.reset();

    var getRequestId = function() {
      return oasisId + '-' + requestId++;
    };

    function mustImplement(className, name) {
      return function() {
        throw new Error("Subclasses of " + className + " must implement " + name);
      };
    }

    /**
      OasisPort is an interface that adapters can use to implement ports.
      Ports are passed into the `initialize` method of services and consumers,
      and are available as `this.port` on services and consumers.

      Ports are the low-level API that can be used to communicate with the
      other side of a connection. In general, you will probably want to use
      the `events` and `requests` objects inside your service or consumer
      rather than manually listen for events and requests.

      @constructor
      @param {OasisPort} port
    */
    function OasisPort(port) {}

    OasisPort.prototype = {
      /**
        This allows you to register an event handler for a particular event
        name.

        @param {String} eventName the name of the event
        @param {Function} callback the callback to call when the event occurs
        @param {any?} binding an optional value of `this` inside of the callback
      */
      on: mustImplement('OasisPort', 'on'),

      /**
        This allows you to unregister an event handler for an event name
        and callback. You should not pass in the optional binding.

        @param {String} eventName the name of the event
        @param {Function} callback a reference to the callback that was
          passed into `.on`.
      */
      off: mustImplement('OasisPort', 'off'),

      /**
        This method sends an event to the other side of the connection.

        @param {String} eventName the name of the event
        @param {Structured?} data optional data to pass along with the event
      */
      send: mustImplement('OasisPort', 'send'),

      /**
        @private

        Adapters should implement this to start receiving messages from the
        other side of the connection.

        It is up to the adapter to make sure that no messages are dropped if
        they are sent before `start` is called.
      */
      start: mustImplement('OasisPort', 'start'),

      /**
        This method sends a request to the other side of the connection.

        @param {String} requestName the name of the request
        @return {Promise} a promise that will be resolved with the value
          provided by the other side of the connection. The fulfillment value
          must be structured data.
      */
      request: function(eventName) {
        var promise = new RSVP.Promise();
        var requestId = getRequestId();
        var args = [].slice.call(arguments, 1);

        var observer = function(event) {
          if (event.requestId === requestId) {
            this.off('@response:' + eventName, observer);
            promise.resolve(event.data);
          }
        };

        this.on('@response:' + eventName, observer, this);
        this.send('@request:' + eventName, { requestId: requestId, args: args });

        return promise;
      },

      /**
        This method registers a callback to be called when a request is made
        by the other side of the connection.

        The callback will be called with a `resolver` to a promise, that the
        callback should resolve with the fulfillment value.

        @param {String} requestName the name of the request
        @param {Function} callback the callback to be called when a request
          is made.
        @param {any?} binding the value of `this` in the callback
      */
      onRequest: function(eventName, callback, binding) {
        var self = this;

        this.on('@request:' + eventName, function(data) {
          var promise = new RSVP.Promise(),
              requestId = data.requestId,
              args = data.args;

          args.unshift(promise);

          promise.then(function(data) {
            self.send('@response:' + eventName, {
              requestId: requestId,
              data: data
            });
          });


          callback.apply(binding, args);
        });
      }
    };

    var PostMessagePort = extend(OasisPort, {
      initialize: function(port) {
        this.port = port;
        this._callbacks = [];
      },

      on: function(eventName, callback, binding) {
        function wrappedCallback(event) {
          if (event.data.type === eventName) {
            callback.call(binding, event.data.data);
          }
        }

        this._callbacks.push([callback, wrappedCallback]);
        this.port.addEventListener('message', wrappedCallback);
      },

      off: function(eventName, callback) {
        var foundCallback;

        for (var i=0, l=this._callbacks.length; i<l; i++) {
          foundCallback = this._callbacks[i];
          if (foundCallback[0] === callback) {
            this.port.removeEventListener('message', foundCallback[1]);
          }
        }
      },

      send: function(eventName, data) {
        this.port.postMessage({
          type: eventName,
          data: data
        });
      },

      start: function() {
        this.port.start();
      }
    });

    function OasisMessageChannel() {}

    OasisMessageChannel.prototype = {
      start: mustImplement('OasisMessageChannel', 'start')
    };

    var PostMessageMessageChannel = extend(OasisMessageChannel, {
      initialize: function() {
        this.channel = new MessageChannel();
        this.port1 = new PostMessagePort(this.channel.port1);
        this.port2 = new PostMessagePort(this.channel.port2);
      },

      start: function() {
        this.port1.start();
        this.port2.start();
      }
    });

    /**
      This registers a sandbox type inside of the containing environment so that
      it can be referenced by URL in `createSandbox`.

      Options:

      * `capabilities`: An array of service names that will be supplied when calling
        `createSandbox`
      * `url`: The URL of the JavaScript file that contains the sandbox code

      @param {Object} options
    */
    Oasis.register = function(options) {
      assert(options.capabilities, "You are trying to register a package without any capabilities. Please provide a list of requested capabilities, or an empty array ([]).");

      packages[options.url] = options;
    };

    var ports = {};

    if (typeof window !== 'undefined') {
      iframeAdapter.connectSandbox(ports);
    } else {
      Oasis.adapters.webworker.connectSandbox(ports);
    }

    var handlers = {};
    Oasis.registerHandler = function(capability, options) {
      var port = ports[capability];

      if (port) {
        options.setupCapability(port);

        if (options.promise) {
          options.promise.then(function() {
            port.start();
          });
        } else {
          port.start();
        }
      } else {
        handlers[capability] = options;
      }
    };

    Oasis.consumers = {};

    /**
      This is the main entry point that allows sandboxes to connect back
      to their containing environment.

      It should be called once for each service provided by the containing
      environment that it wants to connect to.

      @param {String} serviceName the name of the service to connect to
      @param {Function?} callback the callback to trigger once the other
        side of the connection is available
      @return {Promise} a promise that will be resolved once the other
        side of the connection is available. You can use this instead
        of the callback.
    */
    Oasis.connect = function(capability, callback) {
      function setupCapability(Consumer, name) {
        return function(port) {
          var consumer = new Consumer(port);
          Oasis.consumers[name] = consumer;
          consumer.initialize(port, name);
          port.start();
        };
      }

      if (typeof capability === 'object') {
        var consumers = capability.consumers;

        for (var prop in consumers) {
          Oasis.registerHandler(prop, {
            setupCapability: setupCapability(consumers[prop], prop)
          });
        }
      } else if (callback) {
        Oasis.registerHandler(capability, {
          setupCapability: function(port) {
            callback(port);
          }
        });
      } else {
        var promise = new RSVP.Promise();
        Oasis.registerHandler(capability, {
          promise: promise,
          setupCapability: function(port) {
            promise.resolve(port);
          }
        });

        return promise;
      }
    };

    Oasis.portFor = function(capability) {
      var port = ports[capability];
      assert(port, "You asked for the port for the '" + capability + "' capability, but the environment did not provide one.");
      return port;
    };

    Oasis.RSVP = RSVP;

    return Oasis;
  });
exports.Oasis = requireModule('oasis');
})(this);