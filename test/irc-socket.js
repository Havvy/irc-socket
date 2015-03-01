var sinon = require("sinon");
var assert = require("better-assert");
// var equal = require("deep-eql");
var uinspect = require("util").inspect;
var format = require("util").format;

var debug = false;
var logfn = debug ? console.log.bind(console) : function () {};

var MockSocket = require("./mock-socket.js");
var IrcSocket = require("../irc-socket.js");

// Merge two objects to create a new object,
// taking precedence from the second object.
// Ignores prototypes.
var merge = function (low, high) {
    var res = {};

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

var inspect = function (obj) {
    return uinspect(obj).replace(/\r/g, "\\r").replace(/\n/g, "\\n");
};

// pad to 7 characters (e.g. length("timeout"))
var pad = function (str) {
    return ("      " + str).slice(-9);
};

var baseConfig = {
    nicknames: ["testbot"],
    username: "testuser",
    server: "irc.test.net",
    realname: "realbot",
    port: 6667
};

var messages = {
    rpl_welcome: ":irc.test.net 001 testbot :Welcome to the Test IRC Network testbot!testuser@localhost\r\n",
    rpl_nicknameinuse_testbot: ":irc.test.net 433 * testbot :Nickname is already in use.\r\n",
    rpl_nicknameinuse_testbot_: ":irc.test.net 433 * testbot_ :Nickname is already in use.\r\n",
    ping: "PING :PINGMESSAGE\r\n",
    single: "nick!user@host.net PRIVMSG testbot :Short message.\r\n",
    multi1: "PING :ABC\r\nPRIVMSG somebody :This is a re",
    multi2: "ally long message!\r\n",
    webirc_error: "ERROR :Closing Link: [127.0.0.1] (CGI:IRC -- No access)\r\n"
};

describe("IRC Sockets", function () {
    describe("Status", function () {
        // In this suite, we test the value of 'status' directly.
        // As an end user of this module, you probably do not need
        // to use this value, but if you think you do, it is
        // considered an implementation detail and can change with
        // any release, including bugfixes.

        var socket;

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
            socket.impl.acceptConnect();
            logfn("Status:", socket.status);
            assert(socket.isConnected() === true);
            assert(socket.isStarted() === true);
            assert(socket.isReady() === false);
            assert(socket.status === "starting");
        });

        it("is 'ready' once 001 message is sent", function () {
            socket.connect();
            socket.impl.acceptConnect();
            socket.impl.acceptData(messages.rpl_welcome);
            logfn("Status:", socket.status);
            assert(socket.isConnected() === true);
            assert(socket.isStarted() === true);
            assert(socket.isReady() === true);
            assert(socket.status === "running");
        });

        it("is 'closed' once ended", function () {
            socket.connect();
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
            var socket = IrcSocket(baseConfig, MockSocket(logfn));
            
            var promise = socket.connect()
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
            var socket = IrcSocket(baseConfig, MockSocket(logfn));

            socket.on("ready", function (res) {
                logfn(inspect(res));
                assert(res.nickname === "testbot");
                done();
            });
            
            var promise = socket.connect();

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(1).calledWithExactly("NICK testbot\r\n", "utf-8"));
            socket.impl.acceptData(messages.rpl_welcome);
        });

        it("Minimal config w/failure", function () {
            var socket = IrcSocket(baseConfig, MockSocket(logfn));

            var promise = socket.connect()
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
            var config = merge(baseConfig, {
                socket: MockSocket(logfn),
                nicknames: ["testbot", "testbot_"]
            });
            var socket = IrcSocket(config);

            var promise = socket.connect()
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
            var config = merge(baseConfig, {
                socket: MockSocket(logfn),
                nicknames: ["testbot", "testbot_"]
            });
            var socket = IrcSocket(config);

            var promise = socket.connect()
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
            var config = merge(baseConfig, {
                socket: MockSocket(logfn),
                // socket.raw(["WEBIRC", proxy.password, proxy.username, proxy.hostname, proxy.ip]);
                proxy: {
                    password: "pword",
                    username: "uname",
                    hostname: "hostname.net",
                    ip: "111.11.11.11"
                }
            });
            var socket = IrcSocket(config);

            var promise = socket.connect()
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
            var config = merge(baseConfig, {
                socket: MockSocket(logfn),
                // socket.raw(["WEBIRC", proxy.password, proxy.username, proxy.hostname, proxy.ip]);
                proxy: {
                    password: "pword",
                    username: "uname",
                    hostname: "hostname.net",
                    ip: "111.11.11.11"
                }
            });
            var socket = IrcSocket(config);

            var promise = socket.connect()
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
            var config = merge(baseConfig, {
                socket: MockSocket(logfn),
                password: "123456"
            });
            var socket = IrcSocket(config);

            var promise = socket.connect()
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
            var config = merge(baseConfig, {
                socket: MockSocket(logfn),
                password: "123456"
            });
            var socket = IrcSocket(config);

            var promise = socket.connect()
            .then(function (res) {
                assert(res.isFail());
                assert(res.fail() === IrcSocket.connectFailures.killed);
            });

            socket.impl.acceptConnect();
            assert(socket.impl.write.getCall(0).calledWithExactly("PASS 123456\r\n", "utf-8"));
            assert(socket.impl.write.getCall(1).calledWithExactly("USER testuser 8 * :realbot\r\n", "utf-8"));
            assert(socket.impl.write.getCall(2).calledWithExactly("NICK testbot\r\n", "utf-8"));
            
            socket.impl.end();

            return promise;
        });

        it.skip("Capabilities w/command not found", function () {
            // :irc.eu.mibbit.net 421 Havvy2 BLAH :Unknown command
        });

        // Primarily for Twitch.tv...
        it.skip("Capabilities w/invalid command", function () {
            // :tmi.twitch.tv 410 :Invalid CAP command
        });

        it.skip("Capabilities required w/success", function () {

        });

        it.skip("Capabilities required w/failure", function () {

        });

        it.skip("Capabilities wanted w/AWK", function () {

        });

        it.skip("Capabilities wanted w/NAK", function () {

        });
    });

    describe("handles pings", function () {
        var socket;

        beforeEach(function () {
            socket = IrcSocket(baseConfig, MockSocket(logfn));
            
            var promise = socket.connect();
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
        var socket, clock;
        var fiveMinutes = 5 * 60 * 1000;
        var millisecond = 1;

        var tick = function (milliseconds) {
            logfn(format("     Timer  [TICK] %s", pad(String(milliseconds))));
            clock.tick(milliseconds);
        }

        beforeEach(function () {
            logfn(format("     Timer  [FAKE]"))
            clock = sinon.useFakeTimers();

            socket = IrcSocket(baseConfig, MockSocket(logfn));
            
            var promise = socket.connect();
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
            }, fiveMinutes);

            tick(fiveMinutes + millisecond);
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
                }, fiveMinutes + millisecond);

                tick(fiveMinutes + millisecond);
            }, fiveMinutes);

            tick(fiveMinutes + millisecond);
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
                }, fiveMinutes + millisecond);

                tick(fiveMinutes + millisecond);
            }, fiveMinutes);

            tick(fiveMinutes + millisecond);
        });

        it("times out if the ping is not responded too within five minutes", function (done) {
            setTimeout(function () {
                assert(socket.impl.write.calledWith("PING :ignored\r\n"));

                socket.on("timeout", function () {
                    done();
                });

                setTimeout(function () {
                    done("no timeout");
                }, fiveMinutes + millisecond * 2);

                tick(fiveMinutes + millisecond);
            }, fiveMinutes);

            tick(fiveMinutes + millisecond);
        });
    });

    describe("'data' events", function () {
        var socket;

        beforeEach(function () {
            socket = IrcSocket(baseConfig, MockSocket(logfn));
            
            var promise = socket.connect();
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
            var datas = []
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
    });
});
