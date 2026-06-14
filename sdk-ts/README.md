# @infinitestudios/opentrust-client

TypeScript SDK for OpenTrust, the trust registry and passport layer for AI-agent tools.

Use it to fetch tool passports, inspect trust metadata, and build agent clients that can make safer tool-selection decisions.

## Install

```bash
npm install @infinitestudios/opentrust-client
```

## Basic usage

```ts
import { OpenTrust } from '@infinitestudios/opentrust-client';

const client = new OpenTrust({ baseUrl: 'https://opentrust.sh' });
const passport = await client.getPassport('github/file-search-mcp');
console.log(passport);
```

## Repository

https://github.com/Costder/opentrust/tree/main/sdk-ts

## License

MIT
