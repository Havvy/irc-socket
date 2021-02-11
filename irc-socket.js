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
    socket.timeout = config.timeout || 5 * 60 * 1000;

    socket.connectOptions = typeof config.connectOptions === "object" ? Object.create(config.connectOptions) : {};
    socket.connectOptions.port = config.port || 6667;
    socket.connectOptions.host = config.server;

    socket.on("data", function (line) {
        if (line.slice(0, 4) === "PING") {
            // On PING, respond with a PONG so that we stay connected.
            socket.raw(["PONG", line.slice(line.indexOf(":"))]);
        }
    });

    socket.on("timeout", function () {
        socket.end();
    });

    return socket;
};

Socket.connectFailures = failures;

Socket.prototype = Object.create(EventEmitter.prototype, intoPropertyDescriptors({
    _setHandlers: function () {
        // Socket Timeout variables.
        // After five minutes without a server response, send a PONG.
        // If the server doesn't PING back (or send any message really)
        // within five minutes, we'll have assumed we've be DQed, and
        // end the socket.
        let timeout = null;
        const timeoutPeriod = this.timeout;
        const onSilence = () => {
            timeout = setTimeout(onNoPong, timeoutPeriod);
            this.raw("PING :ignored");
        };
        const onNoPong = () => {
            this.emit("timeout");
        };

        // Data event handling.
        // Transforms the raw stream of data events into a stream of
        // one complete line per data event.
        // Also handles timeouts.
        const dataHandler = (() => {
            const emitLine = this.emit.bind(this, "data");
            let lastLine = "";

            const onData = (data) => {
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

            this.connection.on("data", onData);
        })();

        this.connection.once('connect', () => {
            // Once connected, do the following:
            // 1. Send WEBIRC if proxy set.
            // 2. Send PASS if set.
            // 3. Do capabilities negotiations if set.
            // 4. Send USER
            // 5. Send NICK until one is accepted.
            // 6. Resolve startupPromise.
            // TODO(Havvy): Refactor and clean up!!!

            // If `this.end()` is called before the connect event
            // fires, then we ignore the connect event, since we are
            // already ending/ended.
            if (!this.startupPromise.isPending()) {
                return;
            }
            this.status = "starting";
            this.emit("connect");
            timeout = setTimeout(onSilence, timeoutPeriod);
            let serverCapabilties, acknowledgedCapabilities, sentRequests, respondedRequests, allRequestsSent, nickname;

            if (this.capabilities) {
                this.capabilities.requires = this.capabilities.requires || [];
                this.capabilities.wants = this.capabilities.wants || [];

                serverCapabilties;
                acknowledgedCapabilities = this.capabilities.requires.slice();

                sentRequests = 0;
                respondedRequests = 0;
                allRequestsSent = false;
            }


            const sendUser = () => {
                this.raw(format("USER %s 8 * :%s", this.username, this.realname));
            };

            const sendNick = () => {
                if (this.nicknames.length === 0) {
                    this.raw("QUIT");
                    this.resolvePromise(Fail(failures.nicknamesUnavailable));
                    return;
                }

                nickname = this.nicknames[0];
                this.nicknames.shift();

                this.raw(["NICK", nickname]);
            };

            const startupHandler = (line) => {
                const parts = line.split(" ");

                // If WEBIRC fails.
                if (parts[0] === "ERROR") {
                    this.resolvePromise(Fail(failures.badProxyConfiguration));
                    return;
                // Ignore PINGs.
                } else if (parts[0] === "PING") {
                    return;
                }

                const numeric = parts[1];

                if (numeric === "CAP") {
                    let capabilities = this.capabilities;

                    if (parts[3] === "LS") {
                        serverCapabilties = parts.slice(4);
                        // Remove the colon off the first capability.
                        serverCapabilties[0] = serverCapabilties[0].slice(1);

                        if (capabilities.requires.length !== 0) {
                            if (capabilities.requires.every((capability) => {
                                return includes(serverCapabilties, capability);
                            }))
                            {
                                this.raw(format("CAP REQ :%s", capabilities.requires.join(" ")));
                                sentRequests += 1;
                            } else {
                                this.raw("QUIT");
                                this.resolvePromise(Fail(failures.missingRequiredCapabilities));
                                return;
                            }
                        }

                        capabilities.wants
                        .filter((capability) => {
                            return includes(serverCapabilties, capability);
                        })
                        .forEach((capability) => {
                            this.raw(format("CAP REQ :%s", capability));
                            sentRequests += 1;
                        });

                        return;
                    } else if (parts[3] === "NAK") {
                        respondedRequests += 1;
                        const capability = parts[4].slice(1);

                        if (includes(capabilities.requires, capability)) {
                            this.raw("QUIT");
                            this.resolvePromise(Fail(failures.missingRequiredCapabilities));
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
                        this.raw("CAP END");

                        // 4. Send USER
                        sendUser();

                        // 5. Send NICK
                        sendNick();
                    }
                } else if (numeric === "NOTICE") {
                    if (endsWith(line, "Login unsuccessful")) {
                        // irc.twitch.tv only in their non-standardness.
                        // Server doesn't kill the this. but it doesn't accept input afterwards either.
                        this.resolvePromise(Fail(failures.badPassword));
                    }
                } else if (numeric === "001") {
                    this.status = "running";

                    const data = {
                        capabilities: acknowledgedCapabilities,
                        nickname: nickname
                    };

                    this.emit("ready", data);
                    this.resolvePromise(Ok(data));
                } else if (includes(["410", "421"], numeric)) {
                    // Sent by Twitch.tv when doing a CAP command.
                    if (this.capabilities.requires) {
                        this.raw("QUIT");
                        this.resolvePromise(Fail(failures.missingRequiredCapabilities));
                    } else {
                        // 4. Send USER
                        sendUser();

                        // 5. Send NICK
                        sendNick();
                    }
                } else if (numeric === "464") {
                    // Only sent if a bad password is given.
                    // Server will end the this.afterwards.
                    this.resolvePromise(Fail(failures.badPassword));
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
            this.on("data", startupHandler);
            this.startupPromise.finally((res) => {
                this.removeListener("data", startupHandler);
            });

            // 1. Send WEBIRC
            if (typeof this.proxy === "object") {
                const proxy = this.proxy;

                this.raw(["WEBIRC", proxy.password, proxy.username, proxy.hostname, proxy.ip]);
            }

            // 2. Send PASS
            // Will force kill connection if wrong.
            if (typeof this.password === "string") {
                this.raw(["PASS", this.password]);
            }

            // 3. Send CAP LS
            if (typeof this.capabilities === "object") {
                this.raw("CAP LS");
            } else {
                // 4. Send USER
                sendUser();

                // 5. Send NICK.
                sendNick();
            }
        });

        this.connection.on("error", (error) => {
            this.status = "closed";
            this.emit("error", error);
        });

        this.connection.on("close", () => {
            if (this.status === "starting" || this.status === "connecting") {
                this.resolvePromise(Fail(failures.killed));
            }
            this.status = "closed";
            this.emit("close");
        });

        this.connection.on("end", () => {
            this.emit("end");

            if (this.startupPromise.isPending()) {
                this.resolvePromise(Fail(failures.this.nded));
            }

            // Clean up our timeout.
            clearTimeout(timeout);
        });

        this.connection.on("timeout", () => {
            this.emit("timeout");
        });

        this.connection.setEncoding("utf-8");
        this.connection.setNoDelay();
    },

    connect: function () {
        if (this.isStarted()) {
            throw new Error("Cannot restart an irc-this.Socket.");
        }

        this.status = "connecting";
        this.connection = this.impl.connect(this.connectOptions);
        this._setHandlers(this.connection);
        return this.startupPromise;
    },

    end: function () {
        if (!this.isConnected()) {
            return;
        }

        if (this.startupPromise.isPending()) {
            this.resolvePromise(Fail(failures.socketEnded));
        }

        this.connection.end();
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

        this.connection.write(message + "\r\n", "utf-8");
    },

    setTimeout: function (timeout, callback) {
        this.connection.setTimeout(timeout, callback);
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