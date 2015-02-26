IRC Socket - Socket wrapper to emit irc messages and handle startup.

## Installation ##

```
npm install irc-socket --save
```

## Instantiation ##

```javascript
var NetSocket = require("net").Socket;
var IrcSocket = require("irc-socket");

var netSocket = new Socket();
var ircSocket = IrcSocket({
    socket: netSocket,

    port: 6667,
    server: "irc.someircnetwork.net",
    nicknames: ["freddy", "freddy_"],
    username: "freddy",
    realname: "Freddy",

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
    }
});
```

The following fields are required:

* socket
* server
* port
* nicknames
* username
* realname

If `capab: true` is passed to the configuration object the socket will send `CAP LS` first to initiate a capabilities negotiation.

If `ipv6` is true, the socket will connect over ipv6. If false, it will connect over ipv4. The `localAddress` field is for binding
what IP you connect as. If you don't know that that means, don't define it.

If `secure` is true, then the connection will be over TLS. See `Known Issues` below about using this. `rejectUnauthorized` is `false`
by default. If your irc server has a valid ssl certificate, you can flip this to true.

### Dependency Management ###

A simple irc socket uses a `net.Socket` socket by default. You can pass a
seperate generic socket instead in the second parameter.

If you pass `secure: true` in the network configuration object, this parameter is ignored.

## Starting and Closing the Socket ##

You can either use the "ready" event or use the promises returned by the connect method.

```javascript
var myConnection = IrcSocket(...);
myConnection.once('ready', function () {
    myConnection.end();
}
myConnection.connect();
```

```javascript
var myConnection = IrcSocket(...);
myConnection.connect().then(function (res) {
    // res is of type Result<{nickname, capabilities}, FailReason>
    // If it failed, it already closed itself (or was force killed).
    // Otherwise, it succeeded, and we want to end it ourself.
    if (res.isOk()) {
        myConnection.raw("QUIT");
    }
});
```

## Writing to the Server ##
To send messages to the server, use socket.raw(). It accepts either a
string or an array of Strings. When an array is passed, elments containing
whitespaces will be interpreted as a trailing parameter, else the element
will be left as is. The end result will be joined to a String.
The message '''must''' follow the 
[IRC protocol](https://irc-wiki.org/RFC 1459).

```javascript
var details = {...};
var myConnection = Ircsocket(details);

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
    // This is sent when you do /quit too.
    if (message.slice(0, 5) === "ERROR") {
        mySocket.end();
    }
})
```

The raw method does not allow the usage of newline characters. This is
mostly a security concern, so that if the user of the Socket doesn't
validate input correctly, an evil user can't send a command causing
the bot to quit:

```
<eviluser>!say SUCKAS \nQUIT :Mua ha ha
```

## Reading from the Server ##

You do not need to handle PING messages. They are filtered from the messages
emitted by the socket.

All other messages are emitted via a 'data' event. Receiving callbacks to this
event will receive the message as the first parameter.

Examples of reading messages are in the previous example. Messages generally
look like the following:

```
:irc.uk.mibbit.net 376 Havvy :End of /MOTD command.
:NyanCat!Mibbit@mib-FFFFFFFF.redacted.com QUIT :Quit: http://www.mibbit.com ajax IRC Client
ERROR :Closing Link: Havvy[127-00-00-00.redacted.com] (Quit: Custom quit message.)
```

## Timeouts ##

The IRC socket will listen to ping messages and respond to them 
appropriately, so you do not need to handle this yourself.

Furthermore, if no message has been received from the network within
thirce the normal time it takes for a `PING` message to arrive, the
socket will assume the connection was dropped and end the stream.

Should that not be good enough, you can always use
`setTimeout(number, optionalCallback)` to use the implementing socket's
(usually a net.Socket) timeout mechanisms.

You can listen to the `"timeout"` event for when this occurs.

## Utility Methods ##

### isStarted() ###

This method will return true if the socket was ever started.

### isConnected() ###

This method will return true when the socket is started, but not ended. It
will otherwise return false.

### getRealname() ###

This method returns the realname (sometimes called gecos) of the connection.

### setTimeout(timeout, [callback]) ###

As per the implementation socket. See
[Node documentation](http://nodejs.org/api/net.html#net_socket_settimeout_timeout_callback)
for details.

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
var NetSocket = require("net").Socket;
var IrcSocket = require("irc-socket");

var netSocket = new Socket();
var ircSocket = IrcSocket({
    port: 6667,
    server: "irc.someircnetwork.net",
    nicknames: ["freddy", "freddy_"],
    username: "freddy",
    realname: "Freddy"
});
```

Even though `port` and `server` are part of the Socket connect options, you
must pass them to the IrcSocket options object. For every other connect
option that was supported, you should instead pass the option in the
connectOptions object.

```
var NetSocket = require("net").Socket;
var IrcSocket = require("irc-socket");

var netSocket = new Socket();
var ircSocket = IrcSocket({
    socket: netSocket,
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

For what was a `secure` socket, you must instead wrap a NetSocket around a
TLS socket.

```
var NetSocket = require("net").Socket;
var TlsSocket = require("tls").TLSSocket;
var IrcSocket = require("irc-socket");

var netSocket = new Socket();
var tlsSocket = new TlsSocket(netSocket, {rejectUnauthorized: false});
var IrcSocket = IrcSocket({
    socket: tlsSocket,
    ...
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
