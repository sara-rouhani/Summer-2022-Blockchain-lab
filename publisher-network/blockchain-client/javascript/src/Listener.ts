import type { ClientAgent } from './ClientAgent'
import type { ClientInquirer } from './ClientInquirer'
import type {
  Agent,
  BasicMessageStateChangedEvent,
  CredentialExchangeRecord,
  CredentialStateChangedEvent,
  ProofRecord,
  ProofStateChangedEvent,
} from '@aries-framework/core'
import type BottomBar from 'inquirer/lib/ui/bottom-bar'

import {
  BasicMessageEventTypes,
  BasicMessageRole,
  CredentialEventTypes,
  CredentialState,
  ProofEventTypes,
  ProofState,
} from '@aries-framework/core'
import { ui } from 'inquirer'

import { Color, purpleText } from './OutputClass'

export class Listener {
  public on: boolean
  private ui: BottomBar

  public constructor() {
    this.on = false
    this.ui = new ui.BottomBar()
  }

  private turnListenerOn() {
    this.on = true
  }

  private turnListenerOff() {
    this.on = false
  }

  private printCredentialAttributes(credentialRecord: CredentialExchangeRecord) {
    if (credentialRecord.credentialAttributes) {
      const attribute = credentialRecord.credentialAttributes
      console.log('\n\nCredential preview:')
      attribute.forEach((element) => {
        console.log(purpleText(`${element.name} ${Color.Reset}${element.value}`))
      })
    }
  }

  private async newCredentialPrompt(credentialRecord: CredentialExchangeRecord, clientInquirer: ClientInquirer) {
    this.printCredentialAttributes(credentialRecord)
    this.turnListenerOn()
    await clientInquirer.acceptCredentialOffer(credentialRecord)
    this.turnListenerOff()
  }

  public credentialOfferListener(clientAgent: ClientAgent, clientInquirer: ClientInquirer) {
    clientAgent.agent.events.on(
      CredentialEventTypes.CredentialStateChanged,
      async ({ payload }: CredentialStateChangedEvent) => {
        if (payload.credentialRecord.state === CredentialState.OfferReceived) {
          await this.newCredentialPrompt(payload.credentialRecord, clientInquirer)
        }
      }
    )
  }

  public messageListener(agent: Agent, name: string) {
    agent.events.on(BasicMessageEventTypes.BasicMessageStateChanged, async (event: BasicMessageStateChangedEvent) => {
      if (event.payload.basicMessageRecord.role === BasicMessageRole.Receiver) {
        this.ui.updateBottomBar(purpleText(`message: ${event.payload.message.content}\n`))
      }
    })
  }

  private async newProofRequestPrompt(proofRecord: ProofRecord, clientInquirer: ClientInquirer) {
    this.turnListenerOn()
    await clientInquirer.acceptProofRequest(proofRecord)
    this.turnListenerOff()
  }

  public proofRequestListener(clientAgent: ClientAgent, clientInquirer: ClientInquirer) {
    clientAgent.agent.events.on(ProofEventTypes.ProofStateChanged, async ({ payload }: ProofStateChangedEvent) => {
      if (payload.proofRecord.state === ProofState.RequestReceived  && payload.proofRecord.connectionId === (await clientAgent.getConnectionRecord()).id) {
        await this.newProofRequestPrompt(payload.proofRecord, clientInquirer)
      }
    })
  }

}
