Simple IRC Socket - handles communication between an IRC server and consumers.

The socket is a thin wrapper around a generic socket, 

## Installation ##

```
npm install irc-socket
```

## Instantiation ##

```javascript
var IrcSocket = require('simple-irc-socket');
var myConnection = IrcSocket({
    server: 'irc.yournet.net',
    password: 'server-password',
    nick: 'aBot',
    user: 'node',
    realname: 'Node Simple Socket'
    port: 6667,
    secure: false,
    capab: true
});
```

If `capab: true` is passed to the configuration object the library will send `CAP LS` first to initiate a capabilities negotiation.

### Dependency Management ###

A simple irc socket uses a `net.Socket` socket by default. You can pass a
seperate generic socket instead in the second parameter.

If you pass `secure: true` in the network configuration object, this parameter is ignored.

## Starting and Closing the Socket ##

```javascript
var myConnection = IrcSocket(...);
mySocket.once('ready', function () {
    mySocket.end();
}
mySocket.connect();
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

mySocket.connect();
mySocket.once('ready', function () {
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
validate input, an evil user can't send a command causing the bot to quit:

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
ERROR :Closing Link: Havvy[127-00-00-00.redacted.com] (Quit: I got the messages I want.)
```

## Utility Methods ##

### isConnected() ###

This method will return true when the socket is started, but not ended. It
will otherwise return false.

### getRealname() ###

This method returns the realname (also called gecos) of the connection.

### setTimeout(timeout, [callback]) ###

As per the implementation socket. See
[Node documentation](http://nodejs.org/api/net.html#net_socket_settimeout_timeout_callback)
for details.

## Events ##

The basic-irc-socket is an event emitter. It emits five events.

+ ready(): Once the first 001 message has been acknowledged.
+ data(message: String): Every message (including the 001) from the
sender (inclusive) the the newline (exclusive).
+ close(): Once the implementing socket has been closed.
+ timeout(): When the implementing socket times out.
+ end(): Once the implementing socket emits an 'end' event.

## Testing ##

Install jasmine-node globally, and then test via npm.

```
npm install -g jasmine-node
npm test
```

## Known Issues ##

The socket you pass gets ignored if you pass `secure: true` in the network config.

## See Also

The [irc-message](https://github.com/expr/irc-message) module will quickly parse the strings you pass into objects.

For a full IRC framework, take a look at [Tennu](https://github.com/havvy/tennu).
