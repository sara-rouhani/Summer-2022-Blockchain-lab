import type { Handler, HandlerInboundMessage } from '../../../agent/Handler'
import type { MediationRecipientService } from '../services'

import { MediationDenyMessage } from '../messages'

export class MediationDenyHandler implements Handler {
  private mediationRecipientService: MediationRecipientService
  public supportedMessages = [MediationDenyMessage]

  public constructor(mediationRecipientService: MediationRecipientService) {
    this.mediationRecipientService = mediationRecipientService
  }

  public async handle(messageContext: HandlerInboundMessage<MediationDenyHandler>) {
    if (!messageContext.connection) {
      throw new Error(`Connection for verkey ${messageContext.recipientKey} not found!`)
    }
    await this.mediationRecipientService.processMediationDeny(messageContext)
  }
}
