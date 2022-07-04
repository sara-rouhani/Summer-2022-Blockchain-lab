import { ConnectionRecord } from '@aries-framework/core'
import type { CredDef, Schema } from 'indy-sdk'

import { V1CredentialPreview, AttributeFilter, ProofAttributeInfo, utils } from '@aries-framework/core'

import { BaseAgent } from './BaseAgent'
import { Color, greenText, Output, purpleText, redText } from './OutputClass'


export const runBrokerAgent = async () => {
  const pub = await BrokerAgent.build()
  let urlInput = "http://localhost:9000?oob=eyJAdHlwZSI6Imh0dHBzOi8vZGlkY29tbS5vcmcvb3V0LW9mLWJhbmQvMS4xL2ludml0YXRpb24iLCJAaWQiOiJhOTc5NTI2Yi02NjNjLTQzM2UtYTMzMi1jOGI4ODNkNzMyY2EiLCJsYWJlbCI6ImFsaWNlIiwiYWNjZXB0IjpbImRpZGNvbW0vYWlwMSIsImRpZGNvbW0vYWlwMjtlbnY9cmZjMTkiXSwiaGFuZHNoYWtlX3Byb3RvY29scyI6WyJodHRwczovL2RpZGNvbW0ub3JnL2RpZGV4Y2hhbmdlLzEuMCIsImh0dHBzOi8vZGlkY29tbS5vcmcvY29ubmVjdGlvbnMvMS4wIl0sInNlcnZpY2VzIjpbeyJpZCI6IiNpbmxpbmUtMCIsInNlcnZpY2VFbmRwb2ludCI6Imh0dHA6Ly9sb2NhbGhvc3Q6OTAwMCIsInR5cGUiOiJkaWQtY29tbXVuaWNhdGlvbiIsInJlY2lwaWVudEtleXMiOlsiZGlkOmtleTp6Nk1raE45bzhKamVaM1BBNEZraUtETXdyamNBbk1rWmI5c1dFZFdTaW1MdExiUTMiXSwicm91dGluZ0tleXMiOltdfV19"
  await pub.acceptConnection(urlInput)
  pub.issueCredential()
}

export class BrokerAgent extends BaseAgent {
  public connectionRecordClientId?: string
  public credentialDefinition?: CredDef

  public constructor(port: number, name: string) {
    super(port, name)
  }

  public static async build(): Promise<BrokerAgent> {
    const broker = new BrokerAgent(9003, 'broker')
    await broker.initializeAgent()
    return broker
  }

  private async getConnectionRecord() {
    if (!this.connectionRecordClientId) {
      throw Error(redText(Output.MissingConnectionRecord))
    }
    return await this.agent.connections.getById(this.connectionRecordClientId)
  }


  private async receiveConnectionRequest(invitationUrl: string) {
    const { connectionRecord } = await this.agent.oob.receiveInvitationFromUrl(invitationUrl)
    if (!connectionRecord) {
      throw new Error(redText(Output.NoConnectionRecordFromOutOfBand))
    }
    return connectionRecord
  }

  private async waitForConnection(connectionRecord: ConnectionRecord) {
    connectionRecord = await this.agent.connections.returnWhenIsConnected(connectionRecord.id)
    console.log(greenText(Output.ConnectionEstablished))
    return connectionRecord.id
  }

  public async acceptConnection(invitation_url: string) {
    console.log("Paste the invitation urlInput here:\n")
    const connectionRecord = await this.receiveConnectionRequest(invitation_url)
    this.connectionRecordClientId = await this.waitForConnection(connectionRecord)
  }

  private printSchema(name: string, version: string, attributes: string[]) {
    console.log(`\n\nThe credential definition will look like this:\n`)
    console.log(purpleText(`Name: ${Color.Reset}${name}`))
    console.log(purpleText(`Version: ${Color.Reset}${version}`))
    console.log(purpleText(`Attributes: ${Color.Reset}${attributes[0]}, ${attributes[1]}, ${attributes[2]}\n`))
  }

  private async registerSchema() {
    const schemaTemplate = {
      name: 'BrokerAgent College' + utils.uuid(),
      version: '1.0.0',
      attributes: ['name', 'degree', 'date'],
    }
    this.printSchema(schemaTemplate.name, schemaTemplate.version, schemaTemplate.attributes)
    const schema = await this.agent.ledger.registerSchema(schemaTemplate)
    return schema
  }

  private async registerCredentialDefinition(schema: Schema) {
    this.credentialDefinition = await this.agent.ledger.registerCredentialDefinition({
      schema,
      tag: 'latest',
      supportRevocation: false,
    })
    return this.credentialDefinition
  }

  private getCredentialPreview() {
    const credentialPreview = V1CredentialPreview.fromRecord({
      name: 'Alice Smith',
      degree: 'Computer Science',
      date: '01/01/2022',
    })
    return credentialPreview
  }

  public async issueCredential() {
    const schema = await this.registerSchema()
    const credDef = await this.registerCredentialDefinition(schema)
    const credentialPreview = this.getCredentialPreview()
    const connectionRecord = await this.getConnectionRecord()

    await this.agent.credentials.offerCredential({
      connectionId: connectionRecord.id,
      protocolVersion: 'v1',
      credentialFormats: {
        indy: {
          attributes: credentialPreview.attributes,
          credentialDefinitionId: credDef.id,
        },
      },
    })

    
    
  }

  private async printProofFlow(print: string) {
    await new Promise((f) => setTimeout(f, 2000))
  }

  private async newProofAttribute() {
    await this.printProofFlow(greenText(`Creating new proof attribute for 'name' ...\n`))
    const proofAttribute = {
      name: new ProofAttributeInfo({
        name: 'name',
        restrictions: [
          new AttributeFilter({
            credentialDefinitionId: this.credentialDefinition?.id,
          }),
        ],
      }),
    }
    return proofAttribute
  }

  public async sendProofRequest() {
    const connectionRecord = await this.getConnectionRecord()
    const proofAttribute = await this.newProofAttribute()
    await this.printProofFlow(greenText('\nRequesting proof...\n', false))
    await this.agent.proofs.requestProof(connectionRecord.id, {
      requestedAttributes: proofAttribute,
    })
    
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