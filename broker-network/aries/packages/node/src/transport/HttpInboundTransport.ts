import type { InboundTransport, Agent, TransportSession, EncryptedMessage } from '@aries-framework/core'
import type { Express, Request, Response } from 'express'
import type { Server } from 'http'

import { DidCommMimeType, AriesFrameworkError, AgentConfig, TransportService, utils } from '@aries-framework/core'
import express, { text } from 'express'

export class HttpInboundTransport implements InboundTransport {
  public readonly app: Express
  private port: number
  private _server?: Server

  public get server() {
    return this._server
  }

  public constructor({ app, port }: { app?: Express; port: number }) {
    this.port = port

    // Create Express App
    this.app = app ?? express()

    this.app.use(
      text({
        type: [DidCommMimeType.V0, DidCommMimeType.V1],
        limit: '5mb',
      })
    )
  }

  public async start(agent: Agent) {
    const transportService = agent.injectionContainer.resolve(TransportService)
    const config = agent.injectionContainer.resolve(AgentConfig)

    config.logger.debug(`Starting HTTP inbound transport`, {
      port: this.port,
    })

    this.app.post('/', async (req, res) => {
      const session = new HttpTransportSession(utils.uuid(), req, res)
      try {
        const message = req.body
        const encryptedMessage = JSON.parse(message)
        await agent.receiveMessage(encryptedMessage, session)

        // If agent did not use session when processing message we need to send response here.
        if (!res.headersSent) {
          res.status(200).end()
        }
      } catch (error) {
        config.logger.error(`Error processing inbound message: ${error.message}`, error)

        if (!res.headersSent) {
          res.status(500).send('Error processing message')
        }
      } finally {
        transportService.removeSession(session)
      }
    })

    this._server = this.app.listen(this.port)
  }

  public async stop(): Promise<void> {
    this._server?.close()
  }
}

export class HttpTransportSession implements TransportSession {
  public id: string
  public readonly type = 'http'
  public req: Request
  public res: Response

  public constructor(id: string, req: Request, res: Response) {
    this.id = id
    this.req = req
    this.res = res
  }

  public async close(): Promise<void> {
    if (!this.res.headersSent) {
      this.res.status(200).end()
    }
  }

  public async send(encryptedMessage: EncryptedMessage): Promise<void> {
    if (this.res.headersSent) {
      throw new AriesFrameworkError(`${this.type} transport session has been closed.`)
    }

    // FIXME: we should not use json(), but rather the correct
    // DIDComm content-type based on the req and agent config
    this.res.status(200).json(encryptedMessage).end()
  }
}
