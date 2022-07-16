import {
  ConnectionRecord,
  ConnectionStateChangedEvent,
  CredentialExchangeRecord,
  ProofRecord,
  RequestedCredentials,
} from '@aries-framework/core'

import { ConnectionEventTypes } from '@aries-framework/core'

import { BaseAgent } from './BaseAgent'
import { greenText, Output, redText } from './OutputClass'

export class ClientAgent extends BaseAgent {
  public outOfBandId?: string
  public connected: boolean

  public constructor(port: number, name: string) {
    super(port, name)
    this.connected = false
  }

  public static async build(): Promise<ClientAgent> {
    const clientAgent = new ClientAgent(9005, 'clientAgent')
    await clientAgent.initializeAgent()
    return clientAgent
  }

  public async getConnectionRecord() {
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
    return outOfBand.outOfBandInvitation.toUrl({ domain: `http://localhost:${this.port}` })
  }

  public async waitForConnection() {
    if (!this.outOfBandId) {
      throw new Error(redText(Output.MissingConnectionRecord))
    }

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
    this.connected = true
  }

  public async setupConnection() {
    let invitation = await this.printConnectionInvite()
    return invitation
  }

  public async acceptCredentialOffer(credentialRecord: CredentialExchangeRecord) {
    await this.agent.credentials.acceptOffer({
      credentialRecordId: credentialRecord.id,
    })
  }

  public async acceptProofRequest(proofRecord: ProofRecord) {

    try {
      const retrievedCredentials = await this.agent.proofs.getRequestedCredentialsForProofRequest(proofRecord.id, {
        filterByPresentationPreview: true,
        
      })
      // console.log(retrievedCredentials.requestedAttributes.attribute[0].credentialInfo?.attributes)
      // console.log(retrievedCredentials.requestedAttributes.attribute[1].credentialInfo?.attributes)
      // console.log(retrievedCredentials.requestedAttributes.attribute[2].credentialInfo?.attributes)

      let requestedCredentials = this.agent.proofs.autoSelectCredentialsForProofRequest(retrievedCredentials)
      // console.log(requestedCredentials.requestedAttributes)
      await this.agent.proofs.acceptRequest(proofRecord.id, requestedCredentials)
      console.log(greenText('\nProof request accepted!\n'))
    }
    catch (error) {
      await this.agent.proofs.declineRequest(proofRecord.id)
      // console.log(error)
      console.log("Verification unsuccessful")
    }
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
