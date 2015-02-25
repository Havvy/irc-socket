const sinon = require("sinon");
const assert = require("better-assert");
// const equal = require("deep-eql");
const inspect = require("util").inspect;
const format = require("util").format;

const debug = false;
const logfn = debug ? console.log.bind(console) : function () {};

const MockGenericSocket = require("./mock-generic-socket.js");
const IrcSocket = require("../irc-socket.js");

const network = Object.freeze({
    nicknames : ["testbot"],
    username : "testuser",
    server : "irc.test.net",
    realname: "realbot",
    port: 6667
});

const box = function (value) {
    return function () {
        return value;
    };
};

describe("Helper Functions", function () {
    describe("isReady", function () {
        it("emits true for 001 messages", function () {
            assert(IrcSocket.isReady(MockGenericSocket.messages["001"]) === true);
        });

        it("emits false for everything else", function () {
            assert(IrcSocket.isReady(MockGenericSocket.messages.ping) === false);
        });
    });
});

describe("IRC Sockets", function () {
    describe("Know when connected,", function () {
        var socket;

        beforeEach(function () {
            socket = IrcSocket(network, MockGenericSocket);
        });

        it("is not connected at instantiation", function () {
            socket = IrcSocket(network, MockGenericSocket);
            assert(socket.isConnected() === false);
        });

        it("connected once connected.", function () {
            socket.connect();
            assert(socket.isConnected() === true);
        });

        it("not connected once ended", function () {
            socket.connect();
            socket.end();
            assert(socket.isConnected() === false);
        });

        afterEach(function () {
            socket.end();
        });
    });

    describe("Startup procedures", function () {
        it("Sending NICK and USER to the server on connection", function () {
            const genericsocket = MockGenericSocket();
            const socket = IrcSocket(network, box(genericsocket));
            socket.connect();
            socket.end();
            assert(genericsocket.write.calledWith("NICK testbot\r\n", "utf-8"));

            logfn(format("write(\"%s\")", genericsocket.write.secondCall.args[0]));
            assert(genericsocket.write.calledWith("USER testuser 8 * :realbot\r\n", "utf-8"));
        });

        it("Sends Ready Events on 001", function (done) {
            const socket = IrcSocket(network, MockGenericSocket);

            socket.on("ready", function checkForReady () {
                socket.end();
                done();
            });

            socket.connect();
        });
    });

    describe("handles pings", function () {
        var genericsocket, socket;

        beforeEach(function () {
            genericsocket = MockGenericSocket();
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

    describe("timeouts", function () {
        var genericsocket, socket, clock;

        beforeEach(function (done) {
            genericsocket = MockGenericSocket();
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
            genericsocket.emit("data", MockGenericSocket.messages.ping);

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
            genericsocket.emit("data", MockGenericSocket.messages.ping);

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
                genericsocket.emit("data", MockGenericSocket.messages.ping);
                pingsLeft -= 1;
                logfn("pingsLeft is now " + pingsLeft);

                setImmediate(pingLoop)
                clock.tick(1);
            }();
        });
    });

    describe("Emitted data", function () {
        var genericsocket, socket, spy;

        beforeEach(function (done) {
            genericsocket = MockGenericSocket();
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

            genericsocket.emit("data", MockGenericSocket.messages.multi1);
            genericsocket.emit("data", MockGenericSocket.messages.multi2);
        });
    });
});
