const sinon = require("sinon");
const assert = require("better-assert");
const equal = require("deep-eql");
const uinspect = require("util").inspect;
const format = require("util").format;

const debug = false;
const logfn = debug ? console.log.bind(console) : function () {};

const MockSocket = require("@havvy/mock-net-socket");
const IrcSocket = require("../irc-socket.js");

// Merge two objects to create a new object,
// taking precedence from the second object.
// Ignores prototypes.
const merge = function (low, high) {
    const res = {};

    Object.keys(high).forEach(function (key) {
        res[key] = high[key];
    });

    Object.keys(low).forEach(function (key) {
        if (!Object.prototype.hasOwnProperty.call(res, key)) {
            res[key] = low[key];
        }
    });

    return res;
};

const inspect = function (obj) {
    return uinspect(obj).replace(/\r/g, "\\r").replace(/\n/g, "\\n");
};

// pad to 7 characters (e.g. length("timeout"))
const pad = function (str) {
    return ("      " + str).slice(-9);
};

const baseConfig = {
    nicknames: ["testbot"],
    username: "testuser",
    server: "irc.test.net",
    realname: "realbot",
    port: 6667,
    timeout: 200
};

const messages = {
    rpl_welcome: ":irc.test.net 001 testbot :Welcome to the Test IRC Network testbot!testuser@localhost\r\n",
    rpl_nicknameinuse_testbot: ":irc.test.net 433 * testbot :Nickname is already in use.\r\n",
    rpl_nicknameinuse_testbot_: ":irc.test.net 433 * testbot_ :Nickname is already in use.\r\n",
    ping: "PING :PINGMESSAGE\r\n",
    single: "nick!user@host.net PRIVMSG testbot :Short message.\r\n",
    multi1: "PING :ABC\r\nPRIVMSG somebody :This is a re",
    multi2: "ally long message!\r\n",
    webirc_error: "ERROR :Closing Link: [127.0.0.1] (CGI:IRC -- No access)\r\n",
    err_badpassword: ":irc.test.net 464 testbot :Invalid Password\r\n",
    notice_badlogin: ":irc.test.net NOTICE * :Login unsuccessful\r\n",
    cap_ls: ":irc.test.net CAP * LS :a b\r\n",
    cap_ack_a: ":irc.test.net CAP * ACK :a\r\n",
    cap_nak_a: ":irc.test.net CAP * NAK :a\r\n",
    cap_nak_b: ":irc.test.net CAP * NAK :b\r\n",
    cap_not_found_410: ":irc.test.net 410 :Invalid CAP command\r\n",
    cap_not_found_421: ":irc.eu.mibbit.net 421 Havvy2 BLAH :Unknown command\r\n",
    e_with_acute: "\u00E9\r\n",
    e_with_combining_acute: "\u0065\u0301\r\n",
    fi_ligature: "\uFB01\r\n",
    hangul_vowel_string_concat1: "\u1100",
    hangul_vowel_string_concat2: "\u1161\u11A8\r\n"
};

describe("IRC Sockets", function () {
    describe("Status", function () {
        // In this suite, we test the value of 'status' directly.
        // As an end user of this module, you probably do not need
        // to use this value, but if you think you do, it is
        // considered an implementation detail and can change with
        // any release, including bugfixes.

        let socket;

        beforeEach(function () {
            socket = IrcSocket(baseConfig, MockSocket(logfn));
        });

        it("is 'initialized' at instantiation", function () {
            logfn("Status:", socket.status);
            assert(socket.isConnected() === false);
            assert(socket.isStarted() === false);
            assert(socket.isReady() === false);
            assert(socket.status === "initialized")
        });

        it("is 'connecting' once calling socket.connect but before base socket is connected", function () {
            socket.connect();
            logfn("Status:", socket.status);
            assert(socket.isConnected() === true);
            assert(socket.isStarted() === true);
            assert(socket.isReady() === false);
            assert(socket.status === "connecting");
        });

        it("is 'starting' once connected but before the 001 message", function () {
            socket.connect();
            socket.connection.acceptConnect();
            logfn("Status:", socket.status);
            assert(socket.isConnected() === true);
            assert(socket.isStarted() === true);
            assert(socket.isReady() === false);
            assert(socket.status === "starting");
        });

        it("is 'ready' once 001 message is sent", function () {
            socket.connect();
            socket.connection.acceptConnect();
            socket.connection.acceptData(messages.rpl_welcome);
            logfn("Status:", socket.status);
            assert(socket.isConnected() === true);
            assert(socket.isStarted() === true);
            assert(socket.isReady() === true);
            assert(socket.status === "running");
        });

        it("is 'closed' once ended", function () {
            socket.connect().then(function () {}, function () {});
            socket.end();
            logfn("Status:", socket.status);
            assert(socket.isConnected() === false);
            assert(socket.isStarted() === true);
            assert(socket.isReady() === false);
            assert(socket.status === "closed");
        });
    });

    describe("Startup Procedure", function () {
        it("Minimal config w/success", function () {
            const socket = IrcSocket(baseConfig, MockSocket(logfn));

            const promise = socket.connect()
            .then(function (res) {
                logfn(inspect(res));
                assert(res.ok().nickname === "testbot");
            }, assert);

            socket.impl.acceptConnect();

            logfn(inspect(socket.impl.write.getCall(0).args));
            logfn((socket.impl.write.getCall(1).args));
            assert(socket.impl.write.getCall(0).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(1).calledWithExactly("NICK testbot\r\n", "utf-8"));

            socket.impl.acceptData(messages.rpl_welcome);

            return promise;
        });

        it("Minimal config w/success w/ready event", function (done) {
            const socket = IrcSocket(baseConfig, MockSocket(logfn));

            socket.on("ready", function (res) {
                logfn(inspect(res));
                assert(res.nickname === "testbot");
                done();
            });

            const promise = socket.connect();

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(1).calledWithExactly("NICK testbot\r\n", "utf-8"));
            socket.impl.acceptData(messages.rpl_welcome);
        });

        it("Minimal config w/failure", function () {
            const socket = IrcSocket(baseConfig, MockSocket(logfn));

            const promise = socket.connect()
            .then(function (res) {
                assert(res.isFail());
                assert(res.fail() === IrcSocket.connectFailures.nicknamesUnavailable);
                assert(socket.impl.write.getCall(2).calledWithExactly("QUIT\r\n", "utf-8"));
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(1).calledWithExactly("NICK testbot\r\n", "utf-8"));
            socket.impl.acceptData(messages.rpl_nicknameinuse_testbot);

            return promise;
        });

        it("Multiple nicknames w/success", function () {
            const config = merge(baseConfig, {
                socket: MockSocket(logfn),
                nicknames: ["testbot", "testbot_"]
            });
            const socket = IrcSocket(config);

            const promise = socket.connect()
            .then(function (res) {
                assert(res.isOk());
                assert(res.ok().nickname === "testbot_");
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(1).calledWithExactly("NICK testbot\r\n", "utf-8"));
            socket.impl.acceptData(messages.rpl_nicknameinuse_testbot);
            assert(socket.impl.write.getCall(2).calledWithExactly("NICK testbot_\r\n", "utf-8"));
            socket.impl.acceptData(messages.rpl_welcome);

            return promise;
        });

        it("Multiple nicknames w/failure", function () {
            const config = merge(baseConfig, {
                socket: MockSocket(logfn),
                nicknames: ["testbot", "testbot_"]
            });
            const socket = IrcSocket(config);

            const promise = socket.connect()
            .then(function (res) {
                assert(res.isFail());
                assert(res.fail() === IrcSocket.connectFailures.nicknamesUnavailable);
                assert(socket.impl.write.getCall(3).calledWithExactly("QUIT\r\n", "utf-8"));

                // Don't send NICK after running out.
                assert(socket.impl.write.getCall(4) === null);
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(1).calledWithExactly("NICK testbot\r\n", "utf-8"));
            socket.impl.acceptData(messages.rpl_nicknameinuse_testbot);
            assert(socket.impl.write.getCall(2).calledWithExactly("NICK testbot_\r\n", "utf-8"));
            socket.impl.acceptData(messages.rpl_nicknameinuse_testbot_);

            return promise;
        });

        it("WEBIRC w/success", function () {
            const config = merge(baseConfig, {
                socket: MockSocket(logfn),
                // socket.raw(["WEBIRC", proxy.password, proxy.username, proxy.hostname, proxy.ip]);
                proxy: {
                    password: "pword",
                    username: "uname",
                    hostname: "hostname.net",
                    ip: "111.11.11.11"
                }
            });
            const socket = IrcSocket(config);

            const promise = socket.connect()
            .then(function (res) {
                assert(res.ok().nickname === "testbot");
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("WEBIRC pword uname hostname.net 111.11.11.11\r\n", "utf-8"));
            assert(socket.impl.write.getCall(1).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(2).calledWithExactly("NICK testbot\r\n", "utf-8"));
            socket.impl.acceptData(messages.rpl_welcome);

            return promise;
        });

        it("WEBIRC w/failure", function () {
            const config = merge(baseConfig, {
                socket: MockSocket(logfn),
                // socket.raw(["WEBIRC", proxy.password, proxy.username, proxy.hostname, proxy.ip]);
                proxy: {
                    password: "pword",
                    username: "uname",
                    hostname: "hostname.net",
                    ip: "111.11.11.11"
                }
            });
            const socket = IrcSocket(config);

            const promise = socket.connect()
            .then(function (res) {
                assert(res.isFail());
                assert(res.fail() === IrcSocket.connectFailures.badProxyConfiguration);
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("WEBIRC pword uname hostname.net 111.11.11.11\r\n", "utf-8"));
            assert(socket.impl.write.getCall(1).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(2).calledWithExactly("NICK testbot\r\n", "utf-8"));
            socket.impl.acceptData(messages.webirc_error);

            return promise;
        });

        it("Password w/success", function () {
            const config = merge(baseConfig, {
                socket: MockSocket(logfn),
                password: "123456"
            });
            const socket = IrcSocket(config);

            const promise = socket.connect()
            .then(function (res) {
                assert(res.isOk());
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("PASS 123456\r\n", "utf-8"));
            assert(socket.impl.write.getCall(1).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(2).calledWithExactly("NICK testbot\r\n", "utf-8"));
            socket.impl.acceptData(messages.rpl_welcome);

            return promise;
        });

        it("Password w/failure", function () {
            const config = merge(baseConfig, {
                socket: MockSocket(logfn),
                password: "123456"
            });
            const socket = IrcSocket(config);

            const promise = socket.connect()
            .then(function (res) {
                assert(res.isFail());
                assert(res.fail() === IrcSocket.connectFailures.badPassword);
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("PASS 123456\r\n", "utf-8"));
            assert(socket.impl.write.getCall(1).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(2).calledWithExactly("NICK testbot\r\n", "utf-8"));
            socket.impl.acceptData(messages.err_badpassword);
            socket.impl.end();

            return promise;
        });

        it("Password w/failure w/Twitch", function () {
            const config = merge(baseConfig, {
                socket: MockSocket(logfn),
                password: "123456"
            });
            const socket = IrcSocket(config);

            const promise = socket.connect()
            .then(function (res) {
                assert(res.isFail());
                assert(res.fail() === IrcSocket.connectFailures.badPassword);
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("PASS 123456\r\n", "utf-8"));
            assert(socket.impl.write.getCall(1).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(2).calledWithExactly("NICK testbot\r\n", "utf-8"));
            socket.impl.acceptData(messages.notice_badlogin);
            socket.impl.end();

            return promise;
        });

        it("Capabilities w/command not found", function () {
            const config = merge(baseConfig, {
                socket: MockSocket(logfn),
                capabilities: {
                    requires: ["a"]
                }
            });
            const socket = IrcSocket(config);

            const promise = socket.connect()
            .then(function (res) {
                assert(res.fail());
                assert(res.fail() === IrcSocket.connectFailures.missingRequiredCapabilities);
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("CAP LS\r\n", "utf-8"));
            socket.impl.acceptData(messages.cap_not_found_421);
            assert(socket.impl.write.getCall(1).calledWithExactly("QUIT\r\n", "utf-8"));

            return promise;
        });

        // Primarily for Twitch.tv...
        it("Capabilities w/invalid command", function () {
            const config = merge(baseConfig, {
                socket: MockSocket(logfn),
                capabilities: {
                    requires: ["a"]
                }
            });
            const socket = IrcSocket(config);

            const promise = socket.connect()
            .then(function (res) {
                assert(res.fail());
                assert(res.fail() === IrcSocket.connectFailures.missingRequiredCapabilities);
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("CAP LS\r\n", "utf-8"));
            socket.impl.acceptData(messages.cap_not_found_410);
            assert(socket.impl.write.getCall(1).calledWithExactly("QUIT\r\n", "utf-8"));

            return promise;
        });

        it("Capabilities required w/success", function () {
            const config = merge(baseConfig, {
                socket: MockSocket(logfn),
                capabilities: {
                    requires: ["a"]
                }
            });
            const socket = IrcSocket(config);

            const promise = socket.connect()
            .then(function (res) {
                assert(res.isOk());
                assert(equal(res.ok().capabilities, ["a"]));
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("CAP LS\r\n", "utf-8"));
            socket.impl.acceptData(messages.cap_ls);
            assert(socket.impl.write.getCall(1).calledWithExactly("CAP REQ :a\r\n", "utf-8"));
            socket.impl.acceptData(messages.cap_ack_a);
            assert(socket.impl.write.getCall(2).calledWithExactly("CAP END\r\n", "utf-8"));
            assert(socket.impl.write.getCall(3).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(4).calledWithExactly("NICK testbot\r\n", "utf-8"));
            socket.impl.acceptData(messages.rpl_welcome);

            return promise;
        });

        it("Capabilities required w/failure", function () {
            const config = merge(baseConfig, {
                socket: MockSocket(logfn),
                capabilities: {
                    requires: ["a"]
                }
            });
            const socket = IrcSocket(config);

            const promise = socket.connect()
            .then(function (res) {
                assert(res.isFail());

                Object.keys(IrcSocket.connectFailures).filter(function (key) {
                    return IrcSocket.connectFailures[key] === res.fail();
                }).forEach(function (key) {
                    logfn("Key", key);
                })
                assert(res.fail() === IrcSocket.connectFailures.missingRequiredCapabilities);
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("CAP LS\r\n", "utf-8"));
            socket.impl.acceptData(messages.cap_ls);
            assert(socket.impl.write.getCall(1).calledWithExactly("CAP REQ :a\r\n", "utf-8"));
            socket.impl.acceptData(messages.cap_nak_a);

            return promise;
        });

        it("Capabilities wanted w/AWK", function () {
            const config = merge(baseConfig, {
                socket: MockSocket(logfn),
                capabilities: {
                    wants: ["a"]
                }
            });
            const socket = IrcSocket(config);

            const promise = socket.connect()
            .then(function (res) {
                assert(res.isOk());
                assert(equal(res.ok().capabilities, ["a"]));
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("CAP LS\r\n", "utf-8"));
            socket.impl.acceptData(messages.cap_ls);
            assert(socket.impl.write.getCall(1).calledWithExactly("CAP REQ :a\r\n", "utf-8"));
            socket.impl.acceptData(messages.cap_ack_a);
            assert(socket.impl.write.getCall(2).calledWithExactly("CAP END\r\n", "utf-8"));
            assert(socket.impl.write.getCall(3).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(4).calledWithExactly("NICK testbot\r\n", "utf-8"));
            socket.impl.acceptData(messages.rpl_welcome);

            return promise;
        });

        it("Capabilities wanted w/NAK", function () {
            const config = merge(baseConfig, {
                socket: MockSocket(logfn),
                capabilities: {
                    wants: ["a"]
                }
            });
            const socket = IrcSocket(config);

            const promise = socket.connect()
            .then(function (res) {
                assert(res.isOk());
                assert(equal(res.ok().capabilities, []));
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("CAP LS\r\n", "utf-8"));
            socket.impl.acceptData(messages.cap_ls);
            assert(socket.impl.write.getCall(1).calledWithExactly("CAP REQ :a\r\n", "utf-8"));
            socket.impl.acceptData(messages.cap_nak_a);
            assert(socket.impl.write.getCall(2).calledWithExactly("CAP END\r\n", "utf-8"));
            assert(socket.impl.write.getCall(3).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(4).calledWithExactly("NICK testbot\r\n", "utf-8"));
            socket.impl.acceptData(messages.rpl_welcome);

            return promise;
        });

        it("Capabilities wanted (multiple) w/ACK & NAK", function () {
            const config = merge(baseConfig, {
                socket: MockSocket(logfn),
                capabilities: {
                    wants: ["a", "b"]
                }
            });
            const socket = IrcSocket(config);

            const promise = socket.connect()
            .then(function (res) {
                assert(res.isOk());
                assert(equal(res.ok().capabilities, ["a"]));
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("CAP LS\r\n", "utf-8"));
            socket.impl.acceptData(messages.cap_ls);
            assert(socket.impl.write.getCall(1).calledWithExactly("CAP REQ :a\r\n", "utf-8"));
            assert(socket.impl.write.getCall(2).calledWithExactly("CAP REQ :b\r\n", "utf-8"));
            socket.impl.acceptData(messages.cap_ack_a);
            socket.impl.acceptData(messages.cap_nak_b);
            assert(socket.impl.write.getCall(3).calledWithExactly("CAP END\r\n", "utf-8"));
            assert(socket.impl.write.getCall(4).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(5).calledWithExactly("NICK testbot\r\n", "utf-8"));
            socket.impl.acceptData(messages.rpl_welcome);

            return promise;
        });

        it("Config object is not mutated", function () {
            const config = Object.freeze({
                nicknames: Object.freeze(["testbot"]),
                username: "testuser",
                server: "irc.test.net",
                realname: "realbot",
                port: 6667,
                socket: MockSocket(logfn),
                timeout: 200
            });

            const socket = IrcSocket(config);

            const promise = socket.connect()
            .then(function (res) {
                assert(res.isOk());
            });

            socket.impl.acceptConnect();
            logfn(inspect(socket.impl.write.getCall(0).args));
            assert(socket.impl.write.getCall(0).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(1).calledWithExactly("NICK testbot\r\n", "utf-8"));
            socket.impl.acceptData(messages.rpl_welcome);

            return promise;
        });

        it("connectArgs is passed to connect method", function () {
            const config = merge(baseConfig, {});
            const socket = IrcSocket(config, MockSocket(logfn));

            socket.connect();
            socket.impl.acceptConnect();

            assert(equal(socket.impl.connect.getCall(0).args, [{
                port: 6667,
                host: "irc.test.net"
            }]));
        });

        it("Failure by .end() before connect event fired", function () {
            const socket = IrcSocket(baseConfig, MockSocket(logfn));

            const promise = socket.connect()
            .then(function (res) {
                assert(res.isFail());
                assert(res.fail() === IrcSocket.connectFailures.socketEnded);
            });
            socket.end();
            socket.impl.acceptConnect();

            return promise;
        });
    });

    describe("handles pings", function () {
        let socket;

        beforeEach(function () {
            socket = IrcSocket(baseConfig, MockSocket(logfn));

            const promise = socket.connect();
            socket.impl.acceptConnect();
            socket.impl.acceptData(messages.rpl_welcome);
            return promise;
        });

        it("responds to pings", function (done) {
            socket.on("data", function () {
                assert(socket.impl.write.calledWith("PONG :PINGMESSAGE\r\n", "utf-8"));
                done();
            });

            socket.impl.acceptData(messages.ping);
        });
    });

    describe("timeouts", function () {
        let socket, clock;
        const timeout = baseConfig.timeout;
        const millisecond = 1;

        const tick = function (milliseconds) {
            logfn(format("     Timer  [TICK] %s", pad(String(milliseconds))));
            clock.tick(milliseconds);
        }

        beforeEach(function () {
            logfn(format("     Timer  [FAKE]"))
            clock = sinon.useFakeTimers();

            socket = IrcSocket(baseConfig, MockSocket(logfn));
            const promise = socket.connect();
            socket.impl.acceptConnect();
            socket.impl.acceptData(messages.rpl_welcome);

            return promise;
        });

        afterEach(function () {
            logfn(format("     Timer  [REAL]"))
            clock.restore();
        });

        it("sends a ping after 5 minutes of no server response", function (done) {
            setTimeout(function () {
                assert(socket.impl.write.calledWith("PING :ignored\r\n"));
                done();
            }, timeout);

            tick(timeout + millisecond);
        });

        it("stays open if the PING is responded to", function (done) {
            setTimeout(function () {
                assert(socket.impl.write.calledWith("PING :ignored\r\n"));
                socket.impl.acceptData("PONG :ignored\r\n");

                socket.on("timeout", function () {
                    done("timeout");
                });

                setTimeout(function () {
                    assert(socket.isReady());
                    done();
                }, timeout + millisecond);

                tick(timeout + millisecond);
            }, timeout);

            tick(timeout + millisecond);
        });

        it("stays open if any data comes in", function (done) {
            setTimeout(function () {
                assert(socket.impl.write.calledWith("PING :ignored\r\n"));
                socket.impl.acceptData("partial message");

                socket.on("timeout", function () {
                    done("timeout");
                });

                setTimeout(function () {
                    assert(socket.isReady());
                    done();
                }, timeout + millisecond);

                tick(timeout + millisecond);
            }, timeout);

            tick(timeout + millisecond);
        });

        it("times out if the ping is not responded too within five minutes", function (done) {
            setTimeout(function () {
                assert(socket.impl.write.calledWith("PING :ignored\r\n"));

                socket.on("timeout", function () {
                    done();
                });

                // NOTE(Havvy): This fails for one or two milliseconds past,
                //              but not three milliseconds. Not sure why.
                //              Something about what sinon does.
                setTimeout(function () {
                    done("no timeout");
                }, timeout + millisecond * 3);

                tick(timeout + millisecond);
            }, timeout);

            tick(timeout + millisecond);
        });
    });

    describe("'data' events", function () {
        let socket;

        beforeEach(function () {
            socket = IrcSocket(baseConfig, MockSocket(logfn));

            const promise = socket.connect();
            socket.impl.acceptConnect();
            socket.impl.acceptData(messages.rpl_welcome);
            return promise;
        });

        afterEach(function () {
            socket.end();
        });

        it("is a single IRC line", function (done) {
            socket.on("data", function (line) {
                assert(line === messages.single.slice(0, -2));
                done();
            });

            socket.impl.acceptData(messages.single);
        });

        //  :/
        it("handles lines that do not fit in a single impl socket package", function (done) {
            let datas = [];
            socket.on("data", function (line) {
                datas.push(line);

                if (datas.length === 2) {
                    assert(datas[0] === "PING :ABC" && datas[1] === "PRIVMSG somebody :This is a really long message!");
                    done();
                }
            });

            socket.impl.acceptData(messages.multi1);
            socket.impl.acceptData(messages.multi2);
        });

        it("normalizes correctly", function () {
            let datas = [];
            socket.on("data", function (line) {
                datas.push(line);
            });

            socket.impl.acceptData(messages.e_with_acute);
            socket.impl.acceptData(messages.e_with_combining_acute);
            socket.impl.acceptData(messages.fi_ligature);
            assert(datas[0] === datas[1]);
            assert(datas[2] === "\uFB01");
        });

        it("normalizes correctly when faced with multiple lines for a single msg", function () {
            let datas = [];
            socket.on("data", function (line) {
                datas.push(line);
            });

            socket.impl.acceptData(messages.hangul_vowel_string_concat1);
            socket.impl.acceptData(messages.hangul_vowel_string_concat2);
            assert(datas.length === 1);
            assert(datas[0] === "\uAC01");
        })
    });
});
