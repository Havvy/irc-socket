IRC Socket - Socket wrapper to emit irc messages and handle server startup.

We provide for you the following benefits:

* One "data" event per IRC message.
* Pings are automatically ponged too..
* The startup handshake (before the RPL_WELCOME) message is handled.
* A `raw` method to send raw messages to the server.

## Installation ##

```
npm install irc-socket --save
```

## Instantiation ##

```javascript
var net = require("net");
var IrcSocket = require("irc-socket");

var ircSocket = IrcSocket({
    socket: net,

    port: 6667,
    server: "irc.someircnetwork.net",
    nicknames: ["freddy", "freddy_"],
    username: "freddy",
    realname: "Freddy",

    password: "server-password",

    // For transparent proxies using
    // the webirc protocol.
    proxy: {
        password: "shared-webirc-password",
        username: "users-username",
        hostname: "users-hostname",
        ip: "users-ip"
    },

    // For anybody wanting IRC3 capabilities.
    capabilities: {
        requires: ["multi-prefix", "userhost-in-names"],
        wants: ["account-notify"]
    },

    // Passed as the options parameter to socket's
    // connect method.
    // Shown here are example options.
    connectOptions: {
        localAddress: "a-local-address",
        localPort: "a-local-port",
        family: 6, // for ipv6 with net.Socket
    },

    // optional number of milliseconds with no
    // response before timeout is fired
    timeout: 5 * 60 * 1000
});
```

### IrcSocket(config, socket) ###

The IrcSocket constructor is overloaded to provide a convenience form that
takes the socket separately. This is provided so that if the config is created
apart from the Socket, you don't need to modify the config object, especially
since the rest of the configuration values can be serialized as JSON.

```javascript
var net = require("net");
var IrcSocket = require("irc-socket");
var fs = require("fs");

var config = fs.readFileSync("config.json");
var ircSocket = IrcSocket(config, net);
```

### Configuration

The configuration options are as follows.

 - `socket`: [**required**] A net.Socket that IrcSocket wraps around.

 - `server`: [**required**] The server/host to connect to. e.g. "irc.mibbit.net"

 - `port`: [**required**] Which port to connect to. Normally 6667, or 6697 for TLS.

 - `nicknames`: [**required**] Array of nicknames to try to use in order.

 - `username`: [**required**] Username part of the hostmask.

 - `realname`: [**required**] "Real name" to send with the USER command.

 - `password`: Password used to connect to the network. Most networks don't have one.

 - `proxy`: WEBIRC details if your connection is acting as a (probably web-based) proxy.

 - `capabilities`: See the Capabilities section below..

 - `connectOptions`: Options passed to the wrapped socket's connect method. Options `host` and `port` are overwritten. See [io.js's net.Socket.prototype.connect](https://iojs.org/api/net.html#net_socket_connect_options_connectlistener) for options when using `net.Socket` in either Node.js or io.js. (Node.js's documentation is incomplete.)

#### Capabilities ####

Capabilities are a feature added in IRCv3 to extend IRC while still keeping
IRCv2 compatibility. You can see the specification and well-known capabilities
at [their website](http://ircv3.atheme.org/).

Should you want to use IRCv3 features, pass an object with the `requires`
property listing which features you absolutely require and `wants` for
features that you can handle not being there. Both properties are optional.

#### Proxy ####

The proxy object has the following four fields, all required:

- `password`: Shared secret password between you and the network you are connecting with.

- `username`: User or client requesting spoof.

- `hostname`: Hostname of user connecting to your proxy.

- `ip`: IP Address of user connecting to your proxy.

## Starting and Closing the Socket ##

You start and end the socket like a normal net.Socket with the `connect` and
`end` methods. You shouldn't call `end` yourself though. Instead, you should
write a QUIT message to the server (see tnext section).

The `connect` method returns a
`Promise<Result<{capabilities, nickname}, ConnectFailure>, Error>`.

You can either use the "ready" event or use the promises returned by the connect method.

```javascript
var client = IrcSocket(...);
client.once('ready', function () {
    client.end();
}
client.connect();
```

```javascript
var client = IrcSocket(...);
client.connect().then(function (res) {
    // If connect failed, it already closed itself (or was force killed).
    // Otherwise, it succeeded, and we want to end it ourself.
    if (res.isOk()) {
        client.end();
    }
});
```

## Writing to the Server ##
To send messages to the server, use socket.raw(). It accepts either a
string or an array of Strings. The message '''must''' follow the
[IRC protocol](https://irc-wiki.org/RFC 1459).

```javascript
var details = {...};
var client = Ircsocket(details);

mySocket.connect().then(function (res) {
    if (res.isFail()) {
        return;
    }

    // Using a string.
    mySocket.raw("JOIN #biscuits");
}

mySocket.on('data', function (message) {
    message = message.split(" ");

    // Numeric 333 is sent when a user joins a channel.
    if (message[1] === "333" &&
        message[2] === details.nick &&
        message[3] === "#biscuits")
    {
        // Using an array instead of a string.
        mySocket.raw(["PRIVMSG", "#biscuits", ":Hello world."])
    }
});

mySocket.on('data', function (message) {
    // This is sent when you send QUIT too.
    if (message.slice(0, 5) === "ERROR") {
        mySocket.end();
    }
});
```

The raw method does not allow the usage of newline characters.

If an array is passed to `raw`, the message will be joined with a space.

## Reading from the Server ##

All messages are emitted via a 'data' event. Receiving callbacks to this
event will receive the message as the first parameter.

Examples of reading messages are in the previous example. Messages generally
look like the following:

```
:irc.uk.mibbit.net 376 Havvy :End of /MOTD command.
:NyanCat!Mibbit@mib-FFFFFFFF.redacted.com QUIT :Quit: http://www.mibbit.com ajax IRC Client
ERROR :Closing Link: Havvy[127-00-00-00.redacted.com] (Quit: Custom quit message.)
```

All PING messages sent from the server are automatically PONGed too. You
do not need to handle them yourself, but you still receive them, should
you wish to log them.

## Timeouts ##

The IRC socket will listen to ping messages and respond to them
appropriately, so you do not need to handle this yourself.

Furthermore, if no message from the server is sent within five
minutes, the IrcSocket will ping the server. If no response is
thenn sent in five more minutes, the socket will close and emit
a `"timeout"` event.

Should that not be good enough, you can always use
`setTimeout(number, optionalCallback)` to use the implementing
socket's (usually a net.Socket) timeout mechanisms.

You can listen to the `"timeout"` event for when this occurs.

## Utility Methods ##

### isStarted() ###

This method will return true if the socket was ever started.

### isConnected() ###

This method will return true when the socket is started, but not ended. It
will otherwise return false.

### isReady() ###

This method will return true if the RPL_WELCOME message has been sent and the
socket is still open. It will otherwise return false.

### getRealname() ###

This method returns the realname (sometimes called gecos) of the connection.

## Events ##

The irc-socket is an event emitter. It emits five events.

+ ready(): Once the first 001 message has been acknowledged.
+ data(message: String): Every message (including the 001) from the
sender (inclusive) the the newline (exclusive).
+ close(): Once the implementing socket has been closed.
+ timeout(): When either this or the implenting socket time out.
+ end(): Once the implementing socket emits an 'end' event.

## Testing ##

We install `mocha` as a developer dependency, and run tests with that.

```
npm install
npm test
```

## Upgrading from v.2.0.0 ##

All of the legacy compatibility has been removed.

A lot of things have changed/been added.

* Changed: "nickname" property is now "nicknames" and takes an array.
* Changed: You cannot restart an irc-socket Socket.
* Changed: you must pass in your own Socket under the "socket" property. All socket related configuration has been removed.
* Changed: Real support for IRC3 capabilities. "capab" property changed to "capabilities", takes an object now.
* Added: Support for the (Webirc)[http://wiki.mibbit.com/index.php/WebIRC] protocol.
* Added: `isStarted`, `isReady` methods. for more fine grained status tracking.
* Added: `connect` method returns a (Bluebird) Promise that either resolves to a Result of Ok([capabilities]) or Fail(FailReason).
* Removed: Auto-addition of colons in .raw(Array) are gone. Put them in yourself as needed.
* Added `debug` property which takes a function like `console.log`.

### Configuration

You *must* rename the `nickname` property to `nicknames` and change it to an array.
This was done so that we can have multiple nicknames. Should all of them be not
accepted, the socket will close itself.

If you were using the (practically useless) `capab` property, you probably want to
use the `capabilities` property which takes an object now.

If you were using `ipv6` you now want to pass `family: 6` to the `connectOptions`
property object now. Likewise, other Socket connect options should go there.

If you were using `secure`, you now want to create a `net.Socket` and then upgrade
it to a `tls.Socket` and finally upgrade that to an `irc-socket`. See the next
section for details.

### Initialization

We now upgrade your socket into an irc-socket instead of instatiating it ourself.

This means that you need to instantiate the socket you want. Once you upgrade the
socket, you give up ownership of it, but gain ownership of the upgraded socket.

```
var net = require("net");
var IrcSocket = require("irc-socket");

var ircSocket = IrcSocket({
    port: 6667,
    server: "irc.someircnetwork.net",
    nicknames: ["freddy", "freddy_"],
    username: "freddy",
    realname: "Freddy"
}, net);
```

Even though `port` and `server` are part of the Socket connect options, you
must pass them to the IrcSocket options object. For every other connect
option that was supported, you should instead pass the option in the
connectOptions object.

```
var net = require("net");
var IrcSocket = require("irc-socket");

var ircSocket = IrcSocket({
    socket: net,
    port: 6667,
    server: "irc.someircnetwork.net",
    nicknames: ["freddy", "freddy_"],
    username: "freddy",
    realname: "Freddy",
    connectOptions: {
        localAddress: aLocalAddress,
        family: 6 // was `ipv6` option in old version, is `family` in net.Socket.
    }
});
```

For what was a `secure` socket, you must instead pass in the
TLS socket object.

```
var tls = require("tls");
var IrcSocket = require("irc-socket");

var IrcSocket = IrcSocket({
    socket: tls,
    ...
    connectionOptions:  {rejectUnauthorized: false}
});
```

### raw([String]) breaking change

If you were using the `raw` method with an array and relying on it to put in colons
for you, you must go back and add those colons in yourself. Just grep for `raw([`
and you should find all of them.

### connect() returns a Promise

Instead of listening to the `ready` event and doing your own startup handling there,
the `connect` method return a Promise. The promise resolves to a
[r-result](https://npmjs.org/package/r-result) result (mostly equivalent to Rust's
Result type) where it is either Ok({capabilities, nickname}) or Fail(ConnectFailureReason).
The connect failure reasons are located at IrcSocket.connectFailures.

## See Also

The [irc-message](https://github.com/expr/irc-message) package will quickly parse the strings you pass into objects.
The new version also merges with `irc-message-stream` to provide a stream.

For a full IRC Bot framework, take a look at [Tennu](https://tennu.github.io).

For long-running IRC Clients, take a look at [IRC Factory](https://github.com/ircanywhere/irc-factory).
