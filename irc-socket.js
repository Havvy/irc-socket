"use strict";

/**
 *
 * IRC Socket
 *
 * Socket that connects to an IRC network and emits each line from the server.
 *
 * Send messages to server with .raw(String) method.
 */

var net = require("net");
var TlsSocket = require("tls").TLSSocket;
var EventEmitter = require("events").EventEmitter;
var inspect = require("util").inspect;
var format = require("util").format;

var intoPropertyDescriptors = function (object) {
    Object.keys(object).forEach(function (key) {
        object[key] = { value: object[key] };
    });

    return object;
};

var includes = function (array, value) {
    return array.indexOf(value) !== -1;
};

var pick = function (object, keys) {
    var newObject = Object.create(Object.getPrototypeOf(object));

    Object.keys(object)
    .filter(function (key) { return includes(keys, key); })
    .forEach(function (key) { newObject[key] = object[key]; });

    return newObject;
};

var Socket = module.exports = function Socket (config, NetSocket) {
    NetSocket = NetSocket || net.Socket;

    var socket = Object.create(Socket.prototype);
    socket.port = config.port || 6667;
    socket.server = config.server;
    socket.ipv6 = config.ipv6 || false;
    socket.localAddress = config.localAddress || undefined;
    socket.secure = config.secure || false;
    socket.rejectUnauthorized = config.rejectUnauthorized || false;
    socket.network = pick(config, ["nickname", "username", "realname", "password", "capabilities"]);
    socket.impl = new NetSocket();
    socket.connected = false;

    socket.impl = new NetSocket();
    if (config.secure) {
        socket.impl = new TlsSocket(socket.impl, { rejectUnauthorized: false });
    }

    socket._setupEvents = function () {
        var onData = function () {
            var emitLine = socket.emit.bind(socket, "data");
            var lastLine = "";

            return function onData (data) {
                // The data event will occassionally only be partially
                // complete. The last line will not end with "\r\n", and
                // need to be appended to the beginning of the first line.
                var lines = data.split("\r\n");
                lines[0] = lastLine + lines[0];
                lastLine = lines.pop();
                lines.forEach(emitLine);
            };
        }();

        var onLine = function () {
            var timeoutInterval = 0;
            var timeout = null;

            return function onLine(line) {
                if (line.slice(0, 4) === "PING") {
                    socket.raw(["PONG", line.slice(line.indexOf(":"))]);

                    // If we don't a message in three times the period
                    // a network sends the first two PINGs out, then
                    // we can assume that we've been disconnected, and
                    // thus should end the session.
                    //
                    // This is a bit janky because most servers only
                    // send PING messages if the client has not sent
                    // a message within its ping duration.
                    //
                    // If a connection joins a channel and just keeps
                    // saying things to the channel every couple seconds
                    // without anybody else saying anything, it's possible
                    // the connection will be disconnected.
                    //
                    // If anybody knows a better way of detecting that
                    // we're no longer receiving messages from the server,
                    // please file an issue explaining or send a pull request.
                    if (timeoutInterval === 0) {
                        timeoutInterval = -(Date.now());
                    } else if (timeoutInterval < 0) {
                        timeoutInterval = (Date.now() + timeoutInterval) * 3;
                        timeout = setTimeout(function () {
                            socket.emit("timeout");
                        }, timeoutInterval);
                    }
                }

                // Any incoming message should reset the timeout.
                if (timeoutInterval > 0) {
                    clearTimeout(timeout);
                    timeout = setTimeout(function () {
                        socket.emit("timeout");
                    }, timeoutInterval);
                }
            };
        }();

        void function readyEvent () {
            var emitWhenReady = function (data) {
                if (Socket.isReady(data)) {
                    socket.emit("ready");
                }
            };

            socket.impl.on("data", emitWhenReady);
            socket.on("ready", function unsubscribeEmitWhenReady () {
                socket.impl.removeListener("data", emitWhenReady);
            });
        }();

        void function connectEvent () {
            var emitEvent = (socket.secure) ? "secureConnect" : "connect";
            var emitWhenConnected = function () {
                socket.localPort = socket.impl.localPort;
                socket.connected = true;
                socket.emit("connect");

                if (socket.network.capab) {
                    socket.raw(["CAP", "LS"]);
                }

                if (typeof socket.network.password === "string") {
                    socket.raw(["PASS", socket.network.password]);
                }

                socket.raw(["NICK", socket.network.nickname]);
                socket.raw(format("USER %s 8 * :%s", socket.network.username || "user", socket.network.realname));
            };

            socket.impl.on(emitEvent, emitWhenConnected);
        }();

        socket.impl.on("error", function (error) {
            socket.connected = false;
            socket.emit("error", error);
        });

        socket.impl.on("close", function () {
            socket.connected = false;
            socket.emit("close");
        });

        socket.impl.on("end", function () {
            socket.emit("end");

            // Clean up our timeout.
            clearTimeout(onLine.timeout);
        });

        socket.impl.on("timeout", function () {
            socket.emit("timeout");
        });

        socket.impl.on("data", onData);
        socket.impl.setEncoding("utf-8");
        socket.impl.setNoDelay();

        socket.on("data", onLine);
        socket.on("timeout", function () {
            socket.end();
        });
    };

    socket._setupEvents();

    return socket;
};

Socket.isReady = function (data) {
    // We are "ready" when we get a 001 message.
    return data.split("\r\n")
    .filter(function (line) { return line !== ""; })
    .some(function (line) { return line.split(" ")[1] === "001"; });
};

Socket.prototype = Object.create(EventEmitter.prototype, intoPropertyDescriptors({
    connect : function () {
        if (this.isConnected()) {
            return;
        }

        this.impl.connect(this.port, this.server, this.ipv6 ? 6 : 4, this.localAddress);
    },

    end : function () {
        if (!this.isConnected()) {
            return;
        }

        this.impl.end();
    },

    raw : function (message) {
        if (!this.connected) {
            return;
        }

        if (Array.isArray(message)) {
            message = message.map(function (m) {
                return (m.indexOf(" ") !== -1) ? ":" + m : m;
            }).join(" ");
        }

        if (message.indexOf("\n") !== -1) {
            throw new Error("Newline detected in message. Use multiple raws instead.");
        }

        this.impl.write(message + "\r\n", "utf-8");
    },
    
    setTimeout: function (timeout, callback) {
        this.impl.setTimeout(timeout, callback);
    },

    isConnected : function () {
        return this.connected;
    },

    getRealName : function () {
        return this._realname;
    }
}));
