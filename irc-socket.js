"use strict";

/**
 *
 * IRC Socket
 *
 * Socket that connects to an IRC network and emits each line from the server.
 *
 * Send messages to server with .raw(String) method.
 */

var EventEmitter = require("events").EventEmitter;
var inspect = require("util").inspect;
var format = require("util").format;
var Promise = require("bluebird");
var rresult = require("r-result");
var Ok = rresult.Ok;
var Fail = rresult.Fail;

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

var failures = {
    killed: {},
    nicknamesUnavailable: {},
    badProxyConfiguration: {},
    missingRequiredCapabilities: {}
};

var Socket = module.exports = function Socket (config) {
    var socket = Object.create(Socket.prototype);

    // Internal implementation values.
    socket.impl = config.socket;
    // status := ["initialized", "connecting", "starting", "running", "closed"]
    socket.status = "initialized";
    socket.startupPromise = new Promise(function (resolve, reject) {
        socket.resolvePromise = resolve;
        socket.rejectPromise = reject;
    });

    // IRC Connection Handshake Options
    socket.proxy = config.proxy;
    socket.password = config.password;
    socket.capabilities = config.capabilities;
    socket.username = config.username;
    socket.realname = config.realname;
    socket.nicknames = config.nicknames;

    // Socket Connection Options
    if (typeof config.connectOptions !== "object") {
        config.connectOptions = {};
    }
    config.connectOptions.port = config.port || 6667;
    config.connectOptions.server = config.server;

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
            var onLine = function onLine(line) {
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
                    if (onLine.timeoutInterval === 0) {
                        onLine.timeoutInterval = -(Date.now());
                    } else if (onLine.timeoutInterval < 0) {
                        onLine.timeoutInterval = (Date.now() + onLine.timeoutInterval) * 3;
                        onLine.timeout = setTimeout(function () {
                            socket.emit("timeout");
                        }, onLine.timeoutInterval);
                    }
                }

                // Any incoming message should reset the timeout.
                if (onLine.timeoutInterval > 0) {
                    clearTimeout(onLine.timeout);
                    onLine.timeout = setTimeout(function () {
                        socket.emit("timeout");
                    }, onLine.timeoutInterval);
                }
            };

            onLine.timeoutInterval = 0;
            onLine.timeout = null;

            return onLine;
        }();

        void function connectEvent () {
            var emitEvent = (socket.secure) ? "secureConnect" : "connect";
            var emitWhenConnected = function () {
                socket.localPort = socket.impl.localPort;
                socket.status = "starting";
                socket.emit("connect");

                // 1. Send WEBIRC if proxy set.
                // 2. Send PASS if set.
                // 3. Do capabilities negotiations if set.
                // 4. Send USER
                // 5. Send NICK until one is accepted.

                // From here to the end of connectionHandler is ugly.
                // Should probably refactor to use Promises at some point.
                if (socket.capabilities) {
                    var serverCapabilties;
                    var acknowledgedCapabilities = socket.capabilities.slice();

                    var sentRequests = 0;
                    var respondedRequests = 0;
                    var allRequestsSent = false;
                }

                var nickname;

                var sendUser = function () {
                    socket.raw(format("USER %s 8 * :%s", socket.username, socket.realname));
                };

                var sendNick = function  () {
                    if (socket.nicknames.length === 0) {
                        socket.raw("QUIT");
                        socket.resolvePromise(Fail(failures.nicknamesUnavailable));
                    }

                    nickname = socket.nicknames[0];
                    socket.nicknames.shift();

                    socket.raw(["NICK", nickname]);
                };

                var startupHandler = function startupHandler (line) {
                    // If WEBIRC fails.
                    if (line.slice(0, 19) === "ERROR") {
                        socket.resolvePromise(Fail(failures.badProxyConfiguration));
                        return;
                    }

                    var parts = line.split(" ");
                    var numeric = parts[1];

                    if (numeric === "CAP") {
                        if (parts[3] === "LS") {
                            serverCapabilties = parts.slice(4);
                            serverCapabilties[0] = serverCapabilties[0].slice(1);

                            if (capabilities.requires && capabilities.requires.every(function (capability) {
                                return includes(serverCapabilties, capability);
                            })) {
                                socket.raw(format("CAP REQ :%s", capabilities.requires.join(" ")));
                                sentRequests += 1;
                            } else {
                                socket.raw("QUIT");
                                socket.resolvePromise(Fail(failures.missingRequiredCapabilities));
                                return;
                            }

                            if (capabilities.wants) {
                                capabilities.wants
                                .filter(function (capability) {
                                    return includes(serverCapabilities, capability);
                                })
                                .forEach(function (capability) {
                                    socket.raw(format("CAP REQ :%s", capability));
                                    sentRequests += 1;
                                });

                                allRequestsSent = true;
                            }

                            return;
                        } else if (parts[3] === "NAK") {
                            respondedRequests += 1;
                            var capability = parts[4].slice(1);

                            if (includes(capabilities.requires, capability)) {
                                socket.raw("QUIT");
                                socket.resolvePromise(Fail(failures.missingRequiredCapabilities));
                                return;
                            }
                        } else if (parts[3] === "ACK") {
                            respondedRequests += 1;

                            var capability = parts[4].slice(1);

                            if (includes(capabilities.wants, capability)) {
                                acknowledgedCapabilities.push(capability);
                            }
                        }

                        if (allRequestsSent && sentRequests === respondedRequests) {
                            // 4. Send USER
                            sendUser();

                            // 5. Send NICK
                            sendNick();
                        }
                    } else if (numeric === "001") {
                        socket.status = "running";
                        socket.removeListener("data", startupHandler);
                        socket.emit("ready");
                        socket.resolvePromise({
                            capabilities: acknowledgedCapabilities,
                            nickname: nickname
                        });
                    } else if (includes(["431", "432", "433", "436", "437", "484"], numeric)) {
                        sendNick();
                    } else if (numeric === "PING") {
                        /* no-op */
                    } else {
                        throw new Error("Unknown message type sent during connection!");
                    }
                };

                socket.on("data", startupHandler);

                // 1. Send WEBIRC
                if (typeof socket.proxy === "object") {
                    var proxy = socket.proxy;

                    socket.on("data", webircHandler);
                    socket.raw(["WEBIRC", proxy.password, proxy.username, proxy.hostname, proxy.ip]);
                }

                // 2. Send PASS
                // Will force kill connection if wrong.
                if (typeof socket.password === "string") {
                    socket.raw(["PASS", socket.password]);
                }

                // 3. Send CAP LS
                if (typeof socket.capabilities === "object") {
                    socket.raw("CAP LS");
                } else {
                    // 4. Send USER
                    sendUser();

                    // 5. Send NICK.
                    sendNick();
                }
            };

            socket.impl.on(emitEvent, emitWhenConnected);
        }();

        socket.impl.on("error", function (error) {
            socket.status = "closed";
            socket.emit("error", error);
        });

        socket.impl.on("close", function () {
            if (socket.status === "starting") {
                socket.resolvePromise(Fail(failures.killed));
            }
            socket.status = "closed";
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

Socket.connectFailures = failures;

Socket.prototype = Object.create(EventEmitter.prototype, intoPropertyDescriptors({
    connect: function () {
        if (this.isStarted()) {
            throw new Error("Cannot restart an irc-socket Socket.");
        }

        this.status = "connecting";
        this.impl.connect(this.port, this.server, this.ipv6 ? 6 : 4, this.localAddress);
    },

    end: function () {
        if (!this.isConnected()) {
            return;
        }

        this.impl.end();
    },

    raw: function (message) {
        if (!this.isConnected()) {
            return;
        }

        if (Array.isArray(message)) {
            message = message.join(" ");
        }

        if (message.indexOf("\n") !== -1) {
            throw new Error("Newline detected in message. Use multiple raws instead.");
        }

        this.impl.write(message + "\r\n", "utf-8");
    },
    
    setTimeout: function (timeout, callback) {
        this.impl.setTimeout(timeout, callback);
    },

    isStarted: function () {
        return this.status !== "initialized";
    },

    isConnected: function () {
        return includes(["connecting", "starting", "running"], this.status);
    },

    isReady: function () {
        return this.status === "running";
    },

    getRealName: function () {
        return this._realname;
    }
}));