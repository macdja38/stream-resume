# stream-resume
https.get but with resuming for streams.

Module does not yet support http or any request verbs other than get,
adding support for those would not be difficult and pull requests are welcome.

By default it only recovers from ECONNRESET, with a max tries of 3. to increase the tries:

```js
let https = require("stream-resume");
https.get({
  maxRetries: 3,
})
```

URL's will have to be parsed with url.parse() before the maxRetries can be modified.

Because of the way the library abstracts over the ClientRequest object at the moment actions to the client request will
not properly carry through to the current request.

Includes unit testing for the RebindableEventEmitter class. Run the test with `npm run test`