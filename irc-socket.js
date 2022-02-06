/**
 *
 * IRC Socket
 *
 * Socket that connects to an IRC network and emits each line from the server.
 *
 * Send messages to server with .raw(String) method.
 */

const EventEmitter = require("events").EventEmitter;
const format = require("util").format;
const rresult = require("r-result");
const Ok = rresult.Ok;
const Fail = rresult.Fail;

const includes = function (array, value) {
    return array.indexOf(value) !== -1;
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
    killed: 'killed',
    nicknamesUnavailable: 'nicknames unavailable',
    badProxyConfiguration: 'bad proxy configuration',
    missingRequiredCapabilities: 'missing required capabilities',
    badPassword: 'bad password',
    socketEnded: 'socket ended'
};

class IrcSocket extends EventEmitter {
    constructor(config, netSocket) {
        super();
        // Internal implementation values.
        this.impl = netSocket || config.socket;
        // status := ["initialized", "connecting", "starting", "running", "closed"]
        this.status = "initialized";
        this.pending = true;
        this.startupPromise = new Promise((resolve, reject) => {
            this.resolvePromise = (res) => {
                this.pending = false;
                resolve(res);
            };
            this.rejectPromise = (res) => {
                this.pending = false;
                reject(res);
            }
        });

        // IRC Connection Handshake Options
        this.proxy = config.proxy;
        this.password = config.password;
        this.capabilities = copyJsonMaybe(config.capabilities)
        if (config.saslPassword) {
            this.saslUsername = config.saslUsername || config.username;
            this.saslPassword = config.saslPassword;
        }
        this.username = config.username;
        this.realname = config.realname;
        this.nicknames = config.nicknames.slice();
        this.timeout = config.timeout || 5 * 60 * 1000;

        this.connectOptions = typeof config.connectOptions === "object" ? Object.create(config.connectOptions) : {};
        this.connectOptions.port = config.port || 6667;
        this.connectOptions.host = config.server;


        this.on("data", function (line) {
            if (line.slice(0, 4) === "PING") {
                // On PING, respond with a PONG so that we stay connected.
                this.raw(["PONG", line.slice(line.indexOf(":"))]);
            }
        });

        this.on("timeout", function () {
            this.end();
        });
    }

    static connectFailures = failures;

    _setHandlers() {
        // Socket Timeout variables.
        // After five minutes without a server response, send a PONG.
        // If the server doesn't PING back (or send any message really)
        // within five minutes, we'll have to assume we've been DQed, and
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
        (() => {
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
            if (!this.pending) { return; }
            this.status = "starting";
            this.emit("connect");
            timeout = setTimeout(onSilence, timeoutPeriod);
            let serverCapabilities, acknowledgedCapabilities, sentRequests, respondedRequests, allRequestsSent, nickname;

            if (this.capabilities) {
                this.capabilities.requires = this.capabilities.requires || [];
                this.capabilities.wants = this.capabilities.wants || [];
                // this.capabilities.requires.push('account-notify');
                // this.capabilities.requires.push('away-notify');
                // this.capabilities.requires.push('cap-notify');
                // this.capabilities.requires.push('chghost');
                // this.capabilities.requires.push('extended-join');
                // this.capabilities.requires.push('multi-prefix');

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
                // console.log("[IRC DEBUG] LINE: ", line);

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
                        serverCapabilities = parts.slice(4);
                        // Remove the colon off the first capability.
                        serverCapabilities[0] = serverCapabilities[0].slice(1);
                        if (capabilities.requires.length !== 0) {
                            if (capabilities.requires.every((capability) => {
                                return includes(serverCapabilities, capability);
                            })) {
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
                              return includes(serverCapabilities, capability);
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
                        if (acknowledgedCapabilities.includes('sasl')) {
                            this.raw(['AUTHENTICATE', 'PLAIN']);
                        }
                    }

                    if (sentRequests === respondedRequests) {
                        if (!this.saslPassword) {
                            this.raw("CAP END");
                        }

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

                } else if (parts[0] === "AUTHENTICATE") {
                    if (parts[1] === '+') {
                        const encPW = Buffer.from(this.saslUsername + '\0' + this.saslUsername + '\0' + this.saslPassword).toString('base64');
                        this.raw(['AUTHENTICATE', encPW]);
                    }
                } else if (numeric === '903') {
                    this.raw("CAP END");
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
            this.startupPromise.finally(() => {
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

            if (this.pending) {
                this.resolvePromise(Fail(failures.socketEnded));
            }

            // Clean up our timeout.
            clearTimeout(timeout);
        });

        this.connection.on("timeout", () => {
            this.emit("timeout");
        });

        this.connection.setEncoding("utf-8");
        this.connection.setNoDelay();
    }

    connect() {
        if (this.isStarted()) {
            throw new Error("Cannot restart an irc Socket.");
        }

        this.status = "connecting";
        this.connection = this.impl.connect(this.connectOptions);
        this._setHandlers(this.connection);
        return this.startupPromise;
    }

    end() {
        if (!this.isConnected()) {
            return;
        }

        if (this.pending) {
            this.resolvePromise(Fail(failures.socketEnded));
        }

        this.connection.end();
    }

    raw(message) {
        if (!this.isConnected()) {
            return;
        }

        if (Array.isArray(message)) {
            message = message.join(" ");
        }

        if (message.indexOf("\n") !== -1) {
            throw new Error("Newline detected in message. Use multiple raws instead.");
        }
        // console.log('[IRC DEBUG] SEND: ' + message);
        this.connection.write(message + "\r\n", "utf-8");
    }

    setTimeout(timeout, callback) {
        this.connection.setTimeout(timeout, callback);
    }

    isStarted() {
        return this.status !== "initialized";
    }

    isConnected() {
        return includes(["connecting", "starting", "running"], this.status);
    }

    isReady() {
        return this.status === "running";
    }

    getRealName() {
        return this._realname;
    }

    /*
    // For debugging tests.

    removeListener: function (message, fn) {
        console.log(format(" IrcSocket   [OFF] %s %s", message, fn.name));
        EventEmitter.prototype.removeListener.apply(this, arguments);
    }
    */
}

module.exports = IrcSocket;