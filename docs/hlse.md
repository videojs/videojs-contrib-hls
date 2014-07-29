# Encrypted HTTP Live Streaming
The [HLS spec](http://tools.ietf.org/html/draft-pantos-http-live-streaming-13#section-6.2.3) requires segments to be encrypted with AES-128 in CBC mode with PKCS7 padding. You can encrypt data to that specification with a combination of [OpenSSL](https://www.openssl.org/) and the [pkcs7 utility](https://github.com/brightcove/pkcs7). From the command-line:

```sh
# encrypt the text "hello" into a file
echo -n "hello" | pkcs7 | openssl enc -aes-128-cbc > hello.encrypted

# encrypt some text and get the bytes in a format that can be easily used for
# testing in javascript
echo -n "hello" | ~/Projects/pkcs7/lib/cli.js | openssl enc -aes-128-cbc | xxd -i
```

Later, you can decrypt it:

```sh
cat hello.encrypted | openssl enc -d -aes-128-cbc
```
