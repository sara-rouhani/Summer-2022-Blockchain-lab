import {
    ConnectionRecord,
    ConnectionStateChangedEvent,
    CredentialEventTypes,
    CredentialState,
    CredentialStateChangedEvent,
    ProofRecord,
  } from '@aries-framework/core'
  
  import { ConnectionEventTypes } from '@aries-framework/core'
  
  import { BaseAgent } from './BaseAgent'
  import { Listener } from './Listener'
  import { Color, greenText, Output, purpleText, redText } from './OutputClass'

  const setupCredentialListener = (holder: PubAgent) => {
    holder.agent.events.on<CredentialStateChangedEvent>(CredentialEventTypes.CredentialStateChanged, async ({ payload }) => {
      switch (payload.credentialRecord.state) {
        case CredentialState.OfferReceived:
          console.log('received a credential')

          if(payload.credentialRecord.credentialAttributes)
          console.log(payload.credentialRecord.credentialAttributes[0])
          await holder.agent.credentials.acceptOffer({ credentialRecordId: payload.credentialRecord.id })
        case CredentialState.Done:
          console.log(`Credential for credential id ${payload.credentialRecord.id} is accepted`)
          process.exit(0)
      }
    })
  }

  export const runPubAgent = async () => {
    const pub = await PubAgent.build()
    await pub.setupConnection()
    }
  
  export class PubAgent extends BaseAgent {
    public outOfBandId?: string
    public connected: boolean
    public listener: Listener
  
    public constructor(port: number, name: string) {
      super(port, name)
      this.listener = new Listener()
      this.connected = false
    }
  
    public static async build(): Promise<PubAgent> {
      const pubAgent = new PubAgent(9002, 'pubAgent')
      await pubAgent.initializeAgent()
      return pubAgent
    }

    public async setupConnection() {
      await this.printConnectionInvite()
      await this.waitForConnection()
      this.acceptCredentialOffer()
    }
  
  
    private async getConnectionRecord() {
      if (!this.outOfBandId) {
        throw Error(redText(Output.MissingConnectionRecord))
      }
  
      const [connection] = await this.agent.connections.findAllByOutOfBandId(this.outOfBandId)
  
      if (!connection) {
        throw Error(redText(Output.MissingConnectionRecord))
      }
  
      return connection
    }
  
    private async printConnectionInvite() {
      
      const outOfBand = await this.agent.oob.createInvitation()
      this.outOfBandId = outOfBand.id
      
  
      console.log(
        Output.ConnectionLink,
        outOfBand.outOfBandInvitation.toUrl({ domain: `http://localhost:${this.port}` }),
        '\n'
      )
    }
  
    private async waitForConnection() {
      if (!this.outOfBandId) {
        throw new Error(redText(Output.MissingConnectionRecord))
      }
  
      console.log('Waiting for broker to finish connection...')
  
      const getConnectionRecord = (outOfBandId: string) =>
        new Promise<ConnectionRecord>((resolve, reject) => {
          // Timeout of 20 seconds
          const timeoutId = setTimeout(() => reject(new Error(redText(Output.MissingConnectionRecord))), 200000)
  
          // Start listener
          this.agent.events.on<ConnectionStateChangedEvent>(ConnectionEventTypes.ConnectionStateChanged, (e) => {
            if (e.payload.connectionRecord.outOfBandId !== outOfBandId) return
            clearTimeout(timeoutId)
            resolve(e.payload.connectionRecord)
          })
  
          // Also retrieve the connection record by invitation if the event has already fired
          void this.agent.connections.findAllByOutOfBandId(outOfBandId).then(([connectionRecord]) => {
            if (connectionRecord) {
              clearTimeout(timeoutId)
              resolve(connectionRecord)
            }
          })
        })
  
      const connectionRecord = await getConnectionRecord(this.outOfBandId)
  
      try {
        await this.agent.connections.returnWhenIsConnected(connectionRecord.id)
      } catch (e) {
        console.log(redText(`\nTimeout of 20 seconds reached.. Returning to home screen.\n`))
        return
      }
      console.log(greenText(Output.ConnectionEstablished))
      this.connected = true
    }
  

    public async acceptCredentialOffer() {
      setupCredentialListener(this);
    }
  
    public async acceptProofRequest(proofRecord: ProofRecord) {
      const retrievedCredentials = await this.agent.proofs.getRequestedCredentialsForProofRequest(proofRecord.id, {
        filterByPresentationPreview: true,
      })
      const requestedCredentials = this.agent.proofs.autoSelectCredentialsForProofRequest(retrievedCredentials)
      await this.agent.proofs.acceptRequest(proofRecord.id, requestedCredentials)
      console.log(greenText('\nProof request accepted!\n'))
    }
  
    public async sendMessage(message: string) {
      const connectionRecord = await this.getConnectionRecord()
      await this.agent.basicMessages.sendMessage(connectionRecord.id, message)
    }
  
    public async exit() {
      console.log(Output.Exit)
      await this.agent.shutdown()
      process.exit(0)
    }
  
    public async restart() {
      await this.agent.shutdown()
    }
  }

