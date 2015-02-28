var sinon = require("sinon");
var assert = require("better-assert");
// var equal = require("deep-eql");
var uinspect = require("util").inspect;
var format = require("util").format;

var debug = true;
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
            var config = Object.create(baseConfig);
            config.socket = MockSocket(logfn);
            socket = new IrcSocket(config);
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
            socket.end();
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
            var config = merge(baseConfig, {socket: MockSocket(logfn)});
            var socket = IrcSocket(config);
            
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
            var config = merge(baseConfig, {socket: MockSocket(logfn)});
            var socket = IrcSocket(config);

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
            var config = merge(baseConfig, {socket: MockSocket(logfn)});
            var socket = IrcSocket(config);

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
    });

    describe.skip("handles pings", function () {
        var genericsocket, socket;

        beforeEach(function () {
            genericsocket = MockSocket();
            socket = IrcSocket(network, box(genericsocket));
        });

        afterEach(function () {
            socket.end();
        });

        it("responds to pings", function (done) {
            socket.on("ready", function () {
                assert(genericsocket.write.calledWith("PONG :PINGMESSAGE\r\n", "utf-8"));
                done();
            });

            socket.connect();
        });
    });

    describe.skip("timeouts", function () {
        var genericsocket, socket, clock;

        beforeEach(function (done) {
            genericsocket = MockSocket();
            socket = IrcSocket(network, box(genericsocket));
            clock = sinon.useFakeTimers();
            socket.on("ready", function () {
                done();
            });
            clock.tick(1);
            socket.connect();
            clock.tick(1);
        });

        afterEach(function () {
            clock.restore();
            socket.end();
        });

        it("handles timeouts", function (done) {
            var timeout_allowed = false;

            socket.on("timeout", function () { 
                assert(timeout_allowed);
                done();
            });

            // Send a ping 1000 time units in the future.
            logfn("Advancing time by 1000");
            clock.tick(1000);
            logfn("Emitting ping.");
            genericsocket.emit("data", MockSocket.messages.ping);

            // setImmediate to let other things happens.
            setImmediate(function () {
                // Move 5000 time units into the future, where no ping
                // from the server means we have timed out.
                timeout_allowed = true;
                logfn("Advancing time by 5000");
                clock.tick(5000);
            });

            // Let the setImmediate happen.
            logfn("Advancing time by 1");
            clock.tick(1);
        });

        it("ends the socket when detecting a timeout", function (done) {
            socket.on("close", function () {
                done();
            });

            clock.tick(1000);
            genericsocket.emit("data", MockSocket.messages.ping);

            setImmediate(function () {
                clock.tick(5000);
            });

            clock.tick(1);
        });

        it("goes through multiple pings without timing out", function (done) {
            socket.on("timeout", function () {
                assert(false);
            });

            var pingsLeft = 4;
            void function pingLoop () {
                if (pingsLeft === 0) {
                    done();
                    return;
                }

                logfn("Ticking 1000 time units");
                clock.tick(1000);
                genericsocket.emit("data", MockSocket.messages.ping);
                pingsLeft -= 1;
                logfn("pingsLeft is now " + pingsLeft);

                setImmediate(pingLoop)
                clock.tick(1);
            }();
        });
    });

    describe.skip("Emitted data", function () {
        var genericsocket, socket, spy;

        beforeEach(function (done) {
            genericsocket = MockSocket();
            socket = IrcSocket(network, box(genericsocket));
            spy = sinon.spy();
            socket.on("data", spy);
            socket.connect();

            socket.on("ready", function () {
                done();
            });
        });

        afterEach(function () {
            socket.end();
        });

        it("emits each IRC line in a data event", function (done) {
            // The first message after the ready event is the 001 message.

            socket.on("data", function (msg) {
                assert(spy.calledWith(":irc.test.net 001 testbot :Welcome to the Test IRC Network testbot!testuser@localhost"));
                done();
            });
        });

        //  :/
        it("handles lines that do not fit in a single impl socket package", function (done) {
            var datas = 0;
            socket.on("data", function () {
                datas += 1;

                if (datas === 3) {
                    assert(spy.calledWith("PING :ABC"));
                    assert(spy.calledWith("PRIVMSG somebody :This is a really long message!"));
                    done();
                }
            });

            genericsocket.emit("data", MockSocket.messages.multi1);
            genericsocket.emit("data", MockSocket.messages.multi2);
        });
    });
});
