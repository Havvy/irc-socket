/**
 *
 * IRC Socket
 *
 * Socket that connects to an IRC network and emits each line from the server.
 *
 * Send messages to server with .raw(String) method.
 */

const EventEmitter = require("events").EventEmitter;
const inspect = require("util").inspect;
const format = require("util").format;
const Promise = require("bluebird");
const rresult = require("r-result");
const Ok = rresult.Ok;
const Fail = rresult.Fail;

const intoPropertyDescriptors = function (object) {
    Object.keys(object).forEach(function (key) {
        object[key] = { value: object[key] };
    });

    return object;
};

const includes = function (array, value) {
    return array.indexOf(value) !== -1;
};

const pick = function (object, keys) {
    var newObject = Object.create(Object.getPrototypeOf(object));

    Object.keys(object)
    .filter(function (key) { return includes(keys, key); })
    .forEach(function (key) { newObject[key] = object[key]; });

    return newObject;
};

const copyJsonMaybe = function (object) {
    if (!object) {
        return undefined;
    }

    return JSON.parse(JSON.stringify(object));
};

const endsWith = function (string, postfix) {
    return string.lastIndexOf(postfix) === string.length - postfix.length;
};

const failures = {
    killed: {},
    nicknamesUnavailable: {},
    badProxyConfiguration: {},
    missingRequiredCapabilities: {},
    badPassword: {},
    socketEnded: {}
};

const Socket = module.exports = function Socket (config, netSocket) {
    const socket = Object.create(Socket.prototype);

    // Internal implementation values.
    socket.impl = netSocket || config.socket;
    // status := ["initialized", "connecting", "starting", "running", "closed"]
    socket.status = "initialized";
    socket.startupPromise = new Promise(function (resolve, reject) {
        socket.resolvePromise = resolve;
        socket.rejectPromise = reject;
    });

    // IRC Connection Handshake Options
    socket.proxy = config.proxy;
    socket.password = config.password;
    socket.capabilities = copyJsonMaybe(config.capabilities);
    socket.username = config.username;
    socket.realname = config.realname;
    socket.nicknames = config.nicknames.slice();

    socket.connectOptions = typeof config.connectOptions === "object" ? Object.create(config.connectOptions) : {};
    socket.connectOptions.port = config.port || 6667;
    socket.connectOptions.host = config.server;

    // Socket Timeout variables.
    // After five minutes without a server response, send a PONG.
    // If the server doesn't PING back (or send any message really)
    // within five minutes, we'll have assumed we've be DQed, and
    // end the socket.
    let timeout = null;
    const timeoutPeriod = config.timeout || 5 * 60 * 1000;
    const onSilence = function () {
        timeout = setTimeout(onNoPong, timeoutPeriod);
        socket.raw("PING :ignored");
    };
    const onNoPong = function () {
        socket.emit("timeout");
    };

    // Data event handling.
    // Transforms the raw stream of data events into a stream of
    // one complete line per data event.
    // Also handles timeouts.
    const dataHandler = function () {
        const emitLine = socket.emit.bind(socket, "data");
        let lastLine = "";

        const onData = function (data) {
            // The data event will occassionally only be partially
            // complete. The last line will not end with "\r\n", and
            // need to be appended to the beginning of the first line.
            //
            // If the last line in the data is complete, then lastLine
            // will be set to an empty string, and appending an empty
            // string to a string does nothing.
            let lines = data.split("\r\n");
            lines[0] = lastLine + lines[0];
            lastLine = lines.pop();
            lines.forEach(function (line) {
              emitLine(line.normalize());
            });

            // We've got data. Reset the timeout.
            clearTimeout(timeout);
            timeout = setTimeout(onSilence, timeoutPeriod);
        };

        socket.impl.on("data", onData);
    }();

    socket.on("data", function (line) {
        if (line.slice(0, 4) === "PING") {
            // On PING, respond with a PONG so that we stay connected.
            socket.raw(["PONG", line.slice(line.indexOf(":"))]);
        }
    });

    // Once connected, do the following:
    // 1. Send WEBIRC if proxy set.
    // 2. Send PASS if set.
    // 3. Do capabilities negotiations if set.
    // 4. Send USER
    // 5. Send NICK until one is accepted.
    // 6. Resolve startupPromise.
    // TODO(Havvy): Refactor and clean up!!!
    socket.impl.once("connect", function doStartup () {
        // If `socket.end()` is called before the connect event
        // fires, then we ignore the connect event, since we are
        // already ending/ended.
        if (!socket.startupPromise.isPending()) {
            return;
        }

        socket.status = "starting";
        socket.emit("connect");
        timeout = setTimeout(onSilence, timeoutPeriod);
        let serverCapabilties, acknowledgedCapabilities, sentRequests, respondedRequests, allRequestsSent, nickname;

        if (socket.capabilities) {
            socket.capabilities.requires = socket.capabilities.requires || [];
            socket.capabilities.wants = socket.capabilities.wants || [];

            serverCapabilties;
            acknowledgedCapabilities = socket.capabilities.requires.slice();

            sentRequests = 0;
            respondedRequests = 0;
            allRequestsSent = false;
        }


        const sendUser = function () {
            socket.raw(format("USER %s 8 * :%s", socket.username, socket.realname));
        };

        const sendNick = function  () {
            if (socket.nicknames.length === 0) {
                socket.raw("QUIT");
                socket.resolvePromise(Fail(failures.nicknamesUnavailable));
                return;
            }

            nickname = socket.nicknames[0];
            socket.nicknames.shift();

            socket.raw(["NICK", nickname]);
        };

        const startupHandler = function startupHandler (line) {
            const parts = line.split(" ");

            // If WEBIRC fails.
            if (parts[0] === "ERROR") {
                socket.resolvePromise(Fail(failures.badProxyConfiguration));
                return;
            // Ignore PINGs.
            } else if (parts[0] === "PING") {
                return;
            }

            const numeric = parts[1];

            if (numeric === "CAP") {
                var capabilities = socket.capabilities;

                if (parts[3] === "LS") {
                    serverCapabilties = parts.slice(4);
                    // Remove the colon off the first capability.
                    serverCapabilties[0] = serverCapabilties[0].slice(1);

                    if (capabilities.requires.length !== 0) {
                        if (capabilities.requires.every(function (capability) {
                            return includes(serverCapabilties, capability);
                        }))
                        {
                            socket.raw(format("CAP REQ :%s", capabilities.requires.join(" ")));
                            sentRequests += 1;
                        } else {
                            socket.raw("QUIT");
                            socket.resolvePromise(Fail(failures.missingRequiredCapabilities));
                            return;
                        }
                    }

                    capabilities.wants
                    .filter(function (capability) {
                        return includes(serverCapabilties, capability);
                    })
                    .forEach(function (capability) {
                        socket.raw(format("CAP REQ :%s", capability));
                        sentRequests += 1;
                    });

                    return;
                } else if (parts[3] === "NAK") {
                    respondedRequests += 1;
                    const capability = parts[4].slice(1);

                    if (includes(capabilities.requires, capability)) {
                        socket.raw("QUIT");
                        socket.resolvePromise(Fail(failures.missingRequiredCapabilities));
                        return;
                    }
                } else if (parts[3] === "ACK") {
                    respondedRequests += 1;

                    const capability = parts[4].slice(1);

                    if (includes(capabilities.wants, capability)) {
                        acknowledgedCapabilities.push(capability);
                    }
                }

                if (sentRequests === respondedRequests) {
                    socket.raw("CAP END");

                    // 4. Send USER
                    sendUser();

                    // 5. Send NICK
                    sendNick();
                }
            } else if (numeric === "NOTICE") {
                if (endsWith(line, "Login unsuccessful")) {
                    // irc.twitch.tv only in their non-standardness.
                    // Server doesn't kill the socket, but it doesn't accept input afterwards either.
                    socket.resolvePromise(Fail(failures.badPassword));
                }
            } else if (numeric === "001") {
                socket.status = "running";

                const data = {
                    capabilities: acknowledgedCapabilities,
                    nickname: nickname
                };

                socket.emit("ready", data);
                socket.resolvePromise(Ok(data));
            } else if (includes(["410", "421"], numeric)) {
                // Sent by Twitch.tv when doing a CAP command.
                if (socket.capabilities.requires) {
                    socket.raw("QUIT");
                    socket.resolvePromise(Fail(failures.missingRequiredCapabilities));
                } else {
                    // 4. Send USER
                    sendUser();

                    // 5. Send NICK
                    sendNick();
                }
            } else if (numeric === "464") {
                // Only sent if a bad password is given.
                // Server will end the socket afterwards.
                socket.resolvePromise(Fail(failures.badPassword));
            } else if (includes(["431", "432", "433", "436", "437", "484"], numeric)) {
                // Reasons you cannot use a nickname. We ignore what it is,
                // and just try with the next nickname.
                sendNick();
            } else if (numeric === "PING") {
                // PINGs are handled elsewhere, and a known message type.
                /* no-op */
            }
        };

        // Subscribe & Unsubscribe
        // TODO(Havvy): Return /this/ Promise,
        socket.on("data", startupHandler);
        socket.startupPromise.finally(function (res) {
            socket.removeListener("data", startupHandler);
        });

        // 1. Send WEBIRC
        if (typeof socket.proxy === "object") {
            const proxy = socket.proxy;

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
    });

    socket.impl.on("error", function (error) {
        socket.status = "closed";
        socket.emit("error", error);
    });

    socket.impl.on("close", function () {
        if (socket.status === "starting" || socket.status === "connecting") {
            socket.resolvePromise(Fail(failures.killed));
        }
        socket.status = "closed";
        socket.emit("close");
    });

    socket.impl.on("end", function () {
        socket.emit("end");

        if (socket.startupPromise.isPending()) {
            socket.resolvePromise(Fail(failures.socketEnded));
        }

        // Clean up our timeout.
        clearTimeout(timeout);
    });

    socket.impl.on("timeout", function () {
        socket.emit("timeout");
    });

    socket.impl.setEncoding("utf-8");
    socket.impl.setNoDelay();

    socket.on("timeout", function () {
        socket.end();
    });

    return socket;
};

Socket.connectFailures = failures;

Socket.prototype = Object.create(EventEmitter.prototype, intoPropertyDescriptors({
    connect: function () {
        if (this.isStarted()) {
            throw new Error("Cannot restart an irc-socket Socket.");
        }

        this.status = "connecting";
        this.impl.connect(this.connectOptions);

        return this.startupPromise;
    },

    end: function () {
        if (!this.isConnected()) {
            return;
        }

        if (this.startupPromise.isPending()) {
            this.resolvePromise(Fail(failures.socketEnded));
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

    /*
    // For debugging tests.

    removeListener: function (message, fn) {
        console.log(format(" IrcSocket   [OFF] %s %s", message, fn.name));
        EventEmitter.prototype.removeListener.apply(this, arguments);
    }
    */
}));
