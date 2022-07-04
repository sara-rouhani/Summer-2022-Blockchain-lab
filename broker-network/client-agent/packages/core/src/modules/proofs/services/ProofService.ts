import type { AgentMessage } from '../../../agent/AgentMessage'
import type { InboundMessageContext } from '../../../agent/models/InboundMessageContext'
import type { Logger } from '../../../logger'
import type { ConnectionRecord } from '../../connections'
import type { AutoAcceptProof } from '../ProofAutoAcceptType'
import type { ProofStateChangedEvent } from '../ProofEvents'
import type { PresentationPreview, PresentationPreviewAttribute } from '../messages'
import type { PresentationProblemReportMessage } from './../messages/PresentationProblemReportMessage'
import type { CredDef, IndyProof, Schema } from 'indy-sdk'

import { validateOrReject } from 'class-validator'
import { inject, Lifecycle, scoped } from 'tsyringe'

import { AgentConfig } from '../../../agent/AgentConfig'
import { EventEmitter } from '../../../agent/EventEmitter'
import { InjectionSymbols } from '../../../constants'
import { Attachment, AttachmentData } from '../../../decorators/attachment/Attachment'
import { AriesFrameworkError } from '../../../error'
import { JsonEncoder } from '../../../utils/JsonEncoder'
import { JsonTransformer } from '../../../utils/JsonTransformer'
import { checkProofRequestForDuplicates } from '../../../utils/indyProofRequest'
import { uuid } from '../../../utils/uuid'
import { Wallet } from '../../../wallet/Wallet'
import { AckStatus } from '../../common'
import { ConnectionService } from '../../connections'
import { IndyCredentialUtils, IndyCredential, CredentialRepository, IndyCredentialInfo } from '../../credentials'
import { IndyHolderService, IndyVerifierService, IndyRevocationService } from '../../indy'
import { IndyLedgerService } from '../../ledger/services/IndyLedgerService'
import { ProofEventTypes } from '../ProofEvents'
import { ProofState } from '../ProofState'
import { PresentationProblemReportError, PresentationProblemReportReason } from '../errors'
import {
  INDY_PROOF_ATTACHMENT_ID,
  INDY_PROOF_REQUEST_ATTACHMENT_ID,
  PresentationAckMessage,
  PresentationMessage,
  ProposePresentationMessage,
  RequestPresentationMessage,
} from '../messages'
import {
  AttributeFilter,
  PartialProof,
  ProofAttributeInfo,
  ProofPredicateInfo,
  ProofRequest,
  RequestedAttribute,
  RequestedCredentials,
  RequestedPredicate,
  RetrievedCredentials,
} from '../models'
import { ProofRepository } from '../repository'
import { ProofRecord } from '../repository/ProofRecord'

/**
 * @todo add method to check if request matches proposal. Useful to see if a request I received is the same as the proposal I sent.
 * @todo add method to reject / revoke messages
 * @todo validate attachments / messages
 */
@scoped(Lifecycle.ContainerScoped)
export class ProofService {
  private proofRepository: ProofRepository
  private credentialRepository: CredentialRepository
  private ledgerService: IndyLedgerService
  private wallet: Wallet
  private logger: Logger
  private indyHolderService: IndyHolderService
  private indyVerifierService: IndyVerifierService
  private indyRevocationService: IndyRevocationService
  private connectionService: ConnectionService
  private eventEmitter: EventEmitter

  public constructor(
    proofRepository: ProofRepository,
    ledgerService: IndyLedgerService,
    @inject(InjectionSymbols.Wallet) wallet: Wallet,
    agentConfig: AgentConfig,
    indyHolderService: IndyHolderService,
    indyVerifierService: IndyVerifierService,
    indyRevocationService: IndyRevocationService,
    connectionService: ConnectionService,
    eventEmitter: EventEmitter,
    credentialRepository: CredentialRepository
  ) {
    this.proofRepository = proofRepository
    this.credentialRepository = credentialRepository
    this.ledgerService = ledgerService
    this.wallet = wallet
    this.logger = agentConfig.logger
    this.indyHolderService = indyHolderService
    this.indyVerifierService = indyVerifierService
    this.indyRevocationService = indyRevocationService
    this.connectionService = connectionService
    this.eventEmitter = eventEmitter
  }

  /**
   * Create a {@link ProposePresentationMessage} not bound to an existing presentation exchange.
   * To create a proposal as response to an existing presentation exchange, use {@link ProofService.createProposalAsResponse}.
   *
   * @param connectionRecord The connection for which to create the presentation proposal
   * @param presentationProposal The presentation proposal to include in the message
   * @param config Additional configuration to use for the proposal
   * @returns Object containing proposal message and associated proof record
   *
   */
  public async createProposal(
    connectionRecord: ConnectionRecord,
    presentationProposal: PresentationPreview,
    config?: {
      comment?: string
      autoAcceptProof?: AutoAcceptProof
    }
  ): Promise<ProofProtocolMsgReturnType<ProposePresentationMessage>> {
    // Assert
    connectionRecord.assertReady()

    // Create message
    const proposalMessage = new ProposePresentationMessage({
      comment: config?.comment,
      presentationProposal,
    })

    // Create record
    const proofRecord = new ProofRecord({
      connectionId: connectionRecord.id,
      threadId: proposalMessage.threadId,
      state: ProofState.ProposalSent,
      proposalMessage,
      autoAcceptProof: config?.autoAcceptProof,
    })
    await this.proofRepository.save(proofRecord)
    this.emitStateChangedEvent(proofRecord, null)

    return { message: proposalMessage, proofRecord }
  }

  /**
   * Create a {@link ProposePresentationMessage} as response to a received presentation request.
   * To create a proposal not bound to an existing presentation exchange, use {@link ProofService.createProposal}.
   *
   * @param proofRecord The proof record for which to create the presentation proposal
   * @param presentationProposal The presentation proposal to include in the message
   * @param config Additional configuration to use for the proposal
   * @returns Object containing proposal message and associated proof record
   *
   */
  public async createProposalAsResponse(
    proofRecord: ProofRecord,
    presentationProposal: PresentationPreview,
    config?: {
      comment?: string
    }
  ): Promise<ProofProtocolMsgReturnType<ProposePresentationMessage>> {
    // Assert
    proofRecord.assertState(ProofState.RequestReceived)

    // Create message
    const proposalMessage = new ProposePresentationMessage({
      comment: config?.comment,
      presentationProposal,
    })
    proposalMessage.setThread({ threadId: proofRecord.threadId })

    // Update record
    proofRecord.proposalMessage = proposalMessage
    await this.updateState(proofRecord, ProofState.ProposalSent)

    return { message: proposalMessage, proofRecord }
  }

  /**
   * Decline a proof request
   * @param proofRecord The proof request to be declined
   */
  public async declineRequest(proofRecord: ProofRecord): Promise<ProofRecord> {
    proofRecord.assertState(ProofState.RequestReceived)

    await this.updateState(proofRecord, ProofState.Declined)

    return proofRecord
  }

  /**
   * Process a received {@link ProposePresentationMessage}. This will not accept the presentation proposal
   * or send a presentation request. It will only create a new, or update the existing proof record with
   * the information from the presentation proposal message. Use {@link ProofService.createRequestAsResponse}
   * after calling this method to create a presentation request.
   *
   * @param messageContext The message context containing a presentation proposal message
   * @returns proof record associated with the presentation proposal message
   *
   */
  public async processProposal(
    messageContext: InboundMessageContext<ProposePresentationMessage>
  ): Promise<ProofRecord> {
    let proofRecord: ProofRecord
    const { message: proposalMessage, connection } = messageContext

    this.logger.debug(`Processing presentation proposal with id ${proposalMessage.id}`)

    try {
      // Proof record already exists
      proofRecord = await this.getByThreadAndConnectionId(proposalMessage.threadId, connection?.id)

      // Assert
      proofRecord.assertState(ProofState.RequestSent)
      this.connectionService.assertConnectionOrServiceDecorator(messageContext, {
        previousReceivedMessage: proofRecord.proposalMessage,
        previousSentMessage: proofRecord.requestMessage,
      })

      // Update record
      proofRecord.proposalMessage = proposalMessage
      await this.updateState(proofRecord, ProofState.ProposalReceived)
    } catch {
      // No proof record exists with thread id
      proofRecord = new ProofRecord({
        connectionId: connection?.id,
        threadId: proposalMessage.threadId,
        proposalMessage,
        state: ProofState.ProposalReceived,
      })

      // Assert
      this.connectionService.assertConnectionOrServiceDecorator(messageContext)

      // Save record
      await this.proofRepository.save(proofRecord)
      this.emitStateChangedEvent(proofRecord, null)
    }

    return proofRecord
  }

  /**
   * Create a {@link RequestPresentationMessage} as response to a received presentation proposal.
   * To create a request not bound to an existing presentation exchange, use {@link ProofService.createRequest}.
   *
   * @param proofRecord The proof record for which to create the presentation request
   * @param proofRequest The proof request to include in the message
   * @param config Additional configuration to use for the request
   * @returns Object containing request message and associated proof record
   *
   */
  public async createRequestAsResponse(
    proofRecord: ProofRecord,
    proofRequest: ProofRequest,
    config?: {
      comment?: string
    }
  ): Promise<ProofProtocolMsgReturnType<RequestPresentationMessage>> {
    // Assert attribute and predicate (group) names do not match
    checkProofRequestForDuplicates(proofRequest)

    // Assert
    proofRecord.assertState(ProofState.ProposalReceived)

    // Create message
    const attachment = new Attachment({
      id: INDY_PROOF_REQUEST_ATTACHMENT_ID,
      mimeType: 'application/json',
      data: new AttachmentData({
        base64: JsonEncoder.toBase64(proofRequest),
      }),
    })
    const requestPresentationMessage = new RequestPresentationMessage({
      comment: config?.comment,
      requestPresentationAttachments: [attachment],
    })
    requestPresentationMessage.setThread({
      threadId: proofRecord.threadId,
    })

    // Update record
    proofRecord.requestMessage = requestPresentationMessage
    await this.updateState(proofRecord, ProofState.RequestSent)

    return { message: requestPresentationMessage, proofRecord }
  }

  /**
   * Create a {@link RequestPresentationMessage} not bound to an existing presentation exchange.
   * To create a request as response to an existing presentation exchange, use {@link ProofService#createRequestAsResponse}.
   *
   * @param proofRequestTemplate The proof request template
   * @param connectionRecord The connection for which to create the presentation request
   * @returns Object containing request message and associated proof record
   *
   */
  public async createRequest(
    proofRequest: ProofRequest,
    connectionRecord?: ConnectionRecord,
    config?: {
      comment?: string
      autoAcceptProof?: AutoAcceptProof
    }
  ): Promise<ProofProtocolMsgReturnType<RequestPresentationMessage>> {
    this.logger.debug(`Creating proof request`)

    // Assert attribute and predicate (group) names do not match
    checkProofRequestForDuplicates(proofRequest)

    // Assert
    connectionRecord?.assertReady()

    // Create message
    const attachment = new Attachment({
      id: INDY_PROOF_REQUEST_ATTACHMENT_ID,
      mimeType: 'application/json',
      data: new AttachmentData({
        base64: JsonEncoder.toBase64(proofRequest),
      }),
    })
    const requestPresentationMessage = new RequestPresentationMessage({
      comment: config?.comment,
      requestPresentationAttachments: [attachment],
    })

    // Create record
    const proofRecord = new ProofRecord({
      connectionId: connectionRecord?.id,
      threadId: requestPresentationMessage.threadId,
      requestMessage: requestPresentationMessage,
      state: ProofState.RequestSent,
      autoAcceptProof: config?.autoAcceptProof,
    })

    await this.proofRepository.save(proofRecord)
    this.emitStateChangedEvent(proofRecord, null)

    return { message: requestPresentationMessage, proofRecord }
  }

  /**
   * Process a received {@link RequestPresentationMessage}. This will not accept the presentation request
   * or send a presentation. It will only create a new, or update the existing proof record with
   * the information from the presentation request message. Use {@link ProofService.createPresentation}
   * after calling this method to create a presentation.
   *
   * @param messageContext The message context containing a presentation request message
   * @returns proof record associated with the presentation request message
   *
   */
  public async processRequest(messageContext: InboundMessageContext<RequestPresentationMessage>): Promise<ProofRecord> {
    let proofRecord: ProofRecord
    const { message: proofRequestMessage, connection } = messageContext

    this.logger.debug(`Processing presentation request with id ${proofRequestMessage.id}`)

    const proofRequest = proofRequestMessage.indyProofRequest

    // Assert attachment
    if (!proofRequest) {
      throw new PresentationProblemReportError(
        `Missing required base64 or json encoded attachment data for presentation request with thread id ${proofRequestMessage.threadId}`,
        { problemCode: PresentationProblemReportReason.Abandoned }
      )
    }
    await validateOrReject(proofRequest)

    // Assert attribute and predicate (group) names do not match
    checkProofRequestForDuplicates(proofRequest)

    this.logger.debug('received proof request', proofRequest)

    try {
      // Proof record already exists
      proofRecord = await this.getByThreadAndConnectionId(proofRequestMessage.threadId, connection?.id)

      // Assert
      proofRecord.assertState(ProofState.ProposalSent)
      this.connectionService.assertConnectionOrServiceDecorator(messageContext, {
        previousReceivedMessage: proofRecord.requestMessage,
        previousSentMessage: proofRecord.proposalMessage,
      })

      // Update record
      proofRecord.requestMessage = proofRequestMessage
      await this.updateState(proofRecord, ProofState.RequestReceived)
    } catch {
      // No proof record exists with thread id
      proofRecord = new ProofRecord({
        connectionId: connection?.id,
        threadId: proofRequestMessage.threadId,
        requestMessage: proofRequestMessage,
        state: ProofState.RequestReceived,
      })

      // Assert
      this.connectionService.assertConnectionOrServiceDecorator(messageContext)

      // Save in repository
      await this.proofRepository.save(proofRecord)
      this.emitStateChangedEvent(proofRecord, null)
    }

    return proofRecord
  }

  /**
   * Create a {@link PresentationMessage} as response to a received presentation request.
   *
   * @param proofRecord The proof record for which to create the presentation
   * @param requestedCredentials The requested credentials object specifying which credentials to use for the proof
   * @param config Additional configuration to use for the presentation
   * @returns Object containing presentation message and associated proof record
   *
   */
  public async createPresentation(
    proofRecord: ProofRecord,
    requestedCredentials: RequestedCredentials,
    config?: {
      comment?: string
    }
  ): Promise<ProofProtocolMsgReturnType<PresentationMessage>> {
    this.logger.debug(`Creating presentation for proof record with id ${proofRecord.id}`)

    // Assert
    proofRecord.assertState(ProofState.RequestReceived)

    const indyProofRequest = proofRecord.requestMessage?.indyProofRequest
    if (!indyProofRequest) {
      throw new PresentationProblemReportError(
        `Missing required base64 or json encoded attachment data for presentation with thread id ${proofRecord.threadId}`,
        { problemCode: PresentationProblemReportReason.Abandoned }
      )
    }

    // Get the matching attachments to the requested credentials
    const attachments = await this.getRequestedAttachmentsForRequestedCredentials(
      indyProofRequest,
      requestedCredentials
    )

    // Create proof
    const proof = await this.createProof(indyProofRequest, requestedCredentials)

    // Create message
    const attachment = new Attachment({
      id: INDY_PROOF_ATTACHMENT_ID,
      mimeType: 'application/json',
      data: new AttachmentData({
        base64: JsonEncoder.toBase64(proof),
      }),
    })

    const presentationMessage = new PresentationMessage({
      comment: config?.comment,
      presentationAttachments: [attachment],
      attachments,
    })
    presentationMessage.setThread({ threadId: proofRecord.threadId })

    // Update record
    proofRecord.presentationMessage = presentationMessage
    await this.updateState(proofRecord, ProofState.PresentationSent)

    return { message: presentationMessage, proofRecord }
  }

  /**
   * Process a received {@link PresentationMessage}. This will not accept the presentation
   * or send a presentation acknowledgement. It will only update the existing proof record with
   * the information from the presentation message. Use {@link ProofService.createAck}
   * after calling this method to create a presentation acknowledgement.
   *
   * @param messageContext The message context containing a presentation message
   * @returns proof record associated with the presentation message
   *
   */
  public async processPresentation(messageContext: InboundMessageContext<PresentationMessage>): Promise<ProofRecord> {
    const { message: presentationMessage, connection } = messageContext

    this.logger.debug(`Processing presentation with id ${presentationMessage.id}`)

    const proofRecord = await this.getByThreadAndConnectionId(presentationMessage.threadId, connection?.id)

    // Assert
    proofRecord.assertState(ProofState.RequestSent)
    this.connectionService.assertConnectionOrServiceDecorator(messageContext, {
      previousReceivedMessage: proofRecord.proposalMessage,
      previousSentMessage: proofRecord.requestMessage,
    })

    // TODO: add proof class with validator
    const indyProofJson = presentationMessage.indyProof
    const indyProofRequest = proofRecord.requestMessage?.indyProofRequest

    if (!indyProofJson) {
      throw new PresentationProblemReportError(
        `Missing required base64 or json encoded attachment data for presentation with thread id ${presentationMessage.threadId}`,
        { problemCode: PresentationProblemReportReason.Abandoned }
      )
    }

    if (!indyProofRequest) {
      throw new PresentationProblemReportError(
        `Missing required base64 or json encoded attachment data for presentation request with thread id ${presentationMessage.threadId}`,
        { problemCode: PresentationProblemReportReason.Abandoned }
      )
    }

    const isValid = await this.verifyProof(indyProofJson, indyProofRequest)

    // Update record
    proofRecord.isVerified = isValid
    proofRecord.presentationMessage = presentationMessage
    await this.updateState(proofRecord, ProofState.PresentationReceived)

    return proofRecord
  }

  /**
   * Create a {@link PresentationAckMessage} as response to a received presentation.
   *
   * @param proofRecord The proof record for which to create the presentation acknowledgement
   * @returns Object containing presentation acknowledgement message and associated proof record
   *
   */
  public async createAck(proofRecord: ProofRecord): Promise<ProofProtocolMsgReturnType<PresentationAckMessage>> {
    this.logger.debug(`Creating presentation ack for proof record with id ${proofRecord.id}`)

    // Assert
    proofRecord.assertState(ProofState.PresentationReceived)

    // Create message
    const ackMessage = new PresentationAckMessage({
      status: AckStatus.OK,
      threadId: proofRecord.threadId,
    })

    // Update record
    await this.updateState(proofRecord, ProofState.Done)

    return { message: ackMessage, proofRecord }
  }

  /**
   * Process a received {@link PresentationAckMessage}.
   *
   * @param messageContext The message context containing a presentation acknowledgement message
   * @returns proof record associated with the presentation acknowledgement message
   *
   */
  public async processAck(messageContext: InboundMessageContext<PresentationAckMessage>): Promise<ProofRecord> {
    const { message: presentationAckMessage, connection } = messageContext

    this.logger.debug(`Processing presentation ack with id ${presentationAckMessage.id}`)

    const proofRecord = await this.getByThreadAndConnectionId(presentationAckMessage.threadId, connection?.id)

    // Assert
    proofRecord.assertState(ProofState.PresentationSent)
    this.connectionService.assertConnectionOrServiceDecorator(messageContext, {
      previousReceivedMessage: proofRecord.requestMessage,
      previousSentMessage: proofRecord.presentationMessage,
    })

    // Update record
    await this.updateState(proofRecord, ProofState.Done)

    return proofRecord
  }

  /**
   * Process a received {@link PresentationProblemReportMessage}.
   *
   * @param messageContext The message context containing a presentation problem report message
   * @returns proof record associated with the presentation acknowledgement message
   *
   */
  public async processProblemReport(
    messageContext: InboundMessageContext<PresentationProblemReportMessage>
  ): Promise<ProofRecord> {
    const { message: presentationProblemReportMessage } = messageContext

    const connection = messageContext.assertReadyConnection()

    this.logger.debug(`Processing problem report with id ${presentationProblemReportMessage.id}`)

    const proofRecord = await this.getByThreadAndConnectionId(presentationProblemReportMessage.threadId, connection?.id)

    proofRecord.errorMessage = `${presentationProblemReportMessage.description.code}: ${presentationProblemReportMessage.description.en}`
    await this.update(proofRecord)
    return proofRecord
  }

  public async generateProofRequestNonce() {
    return this.wallet.generateNonce()
  }

  /**
   * Create a {@link ProofRequest} from a presentation proposal. This method can be used to create the
   * proof request from a received proposal for use in {@link ProofService.createRequestAsResponse}
   *
   * @param presentationProposal The presentation proposal to create a proof request from
   * @param config Additional configuration to use for the proof request
   * @returns proof request object
   *
   */
  public async createProofRequestFromProposal(
    presentationProposal: PresentationPreview,
    config: { name: string; version: string; nonce?: string }
  ): Promise<ProofRequest> {
    const nonce = config.nonce ?? (await this.generateProofRequestNonce())

    const proofRequest = new ProofRequest({
      name: config.name,
      version: config.version,
      nonce,
    })

    /**
     * Create mapping of attributes by referent. This required the
     * attributes to come from the same credential.
     * @see https://github.com/hyperledger/aries-rfcs/blob/master/features/0037-present-proof/README.md#referent
     *
     * {
     *  "referent1": [Attribute1, Attribute2],
     *  "referent2": [Attribute3]
     * }
     */
    const attributesByReferent: Record<string, PresentationPreviewAttribute[]> = {}
    for (const proposedAttributes of presentationProposal.attributes) {
      if (!proposedAttributes.referent) proposedAttributes.referent = uuid()

      const referentAttributes = attributesByReferent[proposedAttributes.referent]

      // Referent key already exist, add to list
      if (referentAttributes) {
        referentAttributes.push(proposedAttributes)
      }
      // Referent key does not exist yet, create new entry
      else {
        attributesByReferent[proposedAttributes.referent] = [proposedAttributes]
      }
    }

    // Transform attributes by referent to requested attributes
    for (const [referent, proposedAttributes] of Object.entries(attributesByReferent)) {
      // Either attributeName or attributeNames will be undefined
      const attributeName = proposedAttributes.length == 1 ? proposedAttributes[0].name : undefined
      const attributeNames = proposedAttributes.length > 1 ? proposedAttributes.map((a) => a.name) : undefined

      const requestedAttribute = new ProofAttributeInfo({
        name: attributeName,
        names: attributeNames,
        restrictions: [
          new AttributeFilter({
            credentialDefinitionId: proposedAttributes[0].credentialDefinitionId,
          }),
        ],
      })

      proofRequest.requestedAttributes.set(referent, requestedAttribute)
    }

    this.logger.debug('proposal predicates', presentationProposal.predicates)
    // Transform proposed predicates to requested predicates
    for (const proposedPredicate of presentationProposal.predicates) {
      const requestedPredicate = new ProofPredicateInfo({
        name: proposedPredicate.name,
        predicateType: proposedPredicate.predicate,
        predicateValue: proposedPredicate.threshold,
        restrictions: [
          new AttributeFilter({
            credentialDefinitionId: proposedPredicate.credentialDefinitionId,
          }),
        ],
      })

      proofRequest.requestedPredicates.set(uuid(), requestedPredicate)
    }

    return proofRequest
  }

  /**
   * Retrieves the linked attachments for an {@link indyProofRequest}
   * @param indyProofRequest The proof request for which the linked attachments have to be found
   * @param requestedCredentials The requested credentials
   * @returns a list of attachments that are linked to the requested credentials
   */
  public async getRequestedAttachmentsForRequestedCredentials(
    indyProofRequest: ProofRequest,
    requestedCredentials: RequestedCredentials
  ): Promise<Attachment[] | undefined> {
    const attachments: Attachment[] = []
    const credentialIds = new Set<string>()
    const requestedAttributesNames: (string | undefined)[] = []

    // Get the credentialIds if it contains a hashlink
    for (const [referent, requestedAttribute] of Object.entries(requestedCredentials.requestedAttributes)) {
      // Find the requested Attributes
      const requestedAttributes = indyProofRequest.requestedAttributes.get(referent) as ProofAttributeInfo

      // List the requested attributes
      requestedAttributesNames.push(...(requestedAttributes.names ?? [requestedAttributes.name]))

      //Get credentialInfo
      if (!requestedAttribute.credentialInfo) {
        const indyCredentialInfo = await this.indyHolderService.getCredential(requestedAttribute.credentialId)
        requestedAttribute.credentialInfo = JsonTransformer.fromJSON(indyCredentialInfo, IndyCredentialInfo)
      }

      // Find the attributes that have a hashlink as a value
      for (const attribute of Object.values(requestedAttribute.credentialInfo.attributes)) {
        if (attribute.toLowerCase().startsWith('hl:')) {
          credentialIds.add(requestedAttribute.credentialId)
        }
      }
    }

    // Only continues if there is an attribute value that contains a hashlink
    for (const credentialId of credentialIds) {
      // Get the credentialRecord that matches the ID

      const credentialRecord = await this.credentialRepository.getSingleByQuery({ credentialIds: [credentialId] })

      if (credentialRecord.linkedAttachments) {
        // Get the credentials that have a hashlink as value and are requested
        const requestedCredentials = credentialRecord.credentialAttributes?.filter(
          (credential) =>
            credential.value.toLowerCase().startsWith('hl:') && requestedAttributesNames.includes(credential.name)
        )

        // Get the linked attachments that match the requestedCredentials
        const linkedAttachments = credentialRecord.linkedAttachments.filter((attachment) =>
          requestedCredentials?.map((credential) => credential.value.split(':')[1]).includes(attachment.id)
        )

        if (linkedAttachments) {
          attachments.push(...linkedAttachments)
        }
      }
    }

    return attachments.length ? attachments : undefined
  }

  /**
   * Create a {@link RetrievedCredentials} object. Given input proof request and presentation proposal,
   * use credentials in the wallet to build indy requested credentials object for input to proof creation.
   * If restrictions allow, self attested attributes will be used.
   *
   *
   * @param proofRequest The proof request to build the requested credentials object from
   * @param presentationProposal Optional presentation proposal to improve credential selection algorithm
   * @returns RetrievedCredentials object
   */
  public async getRequestedCredentialsForProofRequest(
    proofRequest: ProofRequest,
    config: {
      presentationProposal?: PresentationPreview
      filterByNonRevocationRequirements?: boolean
    } = {}
  ): Promise<RetrievedCredentials> {
    const retrievedCredentials = new RetrievedCredentials({})

    for (const [referent, requestedAttribute] of proofRequest.requestedAttributes.entries()) {
      let credentialMatch: IndyCredential[] = []
      const credentials = await this.getCredentialsForProofRequest(proofRequest, referent)

      // If we have exactly one credential, or no proposal to pick preferences
      // on the credentials to use, we will use the first one
      if (credentials.length === 1 || !config.presentationProposal) {
        credentialMatch = credentials
      }
      // If we have a proposal we will use that to determine the credentials to use
      else {
        const names = requestedAttribute.names ?? [requestedAttribute.name]

        // Find credentials that matches all parameters from the proposal
        credentialMatch = credentials.filter((credential) => {
          const { attributes, credentialDefinitionId } = credential.credentialInfo

          // Check if credentials matches all parameters from proposal
          return names.every((name) =>
            config.presentationProposal?.attributes.find(
              (a) =>
                a.name === name &&
                a.credentialDefinitionId === credentialDefinitionId &&
                (!a.value || a.value === attributes[name])
            )
          )
        })
      }

      retrievedCredentials.requestedAttributes[referent] = await Promise.all(
        credentialMatch.map(async (credential: IndyCredential) => {
          const { revoked, deltaTimestamp } = await this.getRevocationStatusForRequestedItem({
            proofRequest,
            requestedItem: requestedAttribute,
            credential,
          })

          return new RequestedAttribute({
            credentialId: credential.credentialInfo.referent,
            revealed: true,
            credentialInfo: credential.credentialInfo,
            timestamp: deltaTimestamp,
            revoked,
          })
        })
      )

      // We only attach revoked state if non-revocation is requested. So if revoked is true it means
      // the credential is not applicable to the proof request
      if (config.filterByNonRevocationRequirements) {
        retrievedCredentials.requestedAttributes[referent] = retrievedCredentials.requestedAttributes[referent].filter(
          (r) => !r.revoked
        )
      }
    }

    for (const [referent, requestedPredicate] of proofRequest.requestedPredicates.entries()) {
      const credentials = await this.getCredentialsForProofRequest(proofRequest, referent)

      retrievedCredentials.requestedPredicates[referent] = await Promise.all(
        credentials.map(async (credential) => {
          const { revoked, deltaTimestamp } = await this.getRevocationStatusForRequestedItem({
            proofRequest,
            requestedItem: requestedPredicate,
            credential,
          })

          return new RequestedPredicate({
            credentialId: credential.credentialInfo.referent,
            credentialInfo: credential.credentialInfo,
            timestamp: deltaTimestamp,
            revoked,
          })
        })
      )

      // We only attach revoked state if non-revocation is requested. So if revoked is true it means
      // the credential is not applicable to the proof request
      if (config.filterByNonRevocationRequirements) {
        retrievedCredentials.requestedPredicates[referent] = retrievedCredentials.requestedPredicates[referent].filter(
          (r) => !r.revoked
        )
      }
    }

    return retrievedCredentials
  }

  /**
   * Takes a RetrievedCredentials object and auto selects credentials in a RequestedCredentials object
   *
   * Use the return value of this method as input to {@link ProofService.createPresentation} to
   * automatically accept a received presentation request.
   *
   * @param retrievedCredentials The retrieved credentials object to get credentials from
   *
   * @returns RequestedCredentials
   */
  public autoSelectCredentialsForProofRequest(retrievedCredentials: RetrievedCredentials): RequestedCredentials {
    const requestedCredentials = new RequestedCredentials({})

    Object.keys(retrievedCredentials.requestedAttributes).forEach((attributeName) => {
      const attributeArray = retrievedCredentials.requestedAttributes[attributeName]

      if (attributeArray.length === 0) {
        throw new AriesFrameworkError('Unable to automatically select requested attributes.')
      } else {
        requestedCredentials.requestedAttributes[attributeName] = attributeArray[0]
      }
    })

    Object.keys(retrievedCredentials.requestedPredicates).forEach((attributeName) => {
      if (retrievedCredentials.requestedPredicates[attributeName].length === 0) {
        throw new AriesFrameworkError('Unable to automatically select requested predicates.')
      } else {
        requestedCredentials.requestedPredicates[attributeName] =
          retrievedCredentials.requestedPredicates[attributeName][0]
      }
    })

    return requestedCredentials
  }

  /**
   * Verify an indy proof object. Will also verify raw values against encodings.
   *
   * @param proofRequest The proof request to use for proof verification
   * @param proofJson The proof object to verify
   * @throws {Error} If the raw values do not match the encoded values
   * @returns Boolean whether the proof is valid
   *
   */
  public async verifyProof(proofJson: IndyProof, proofRequest: ProofRequest): Promise<boolean> {
    const proof = JsonTransformer.fromJSON(proofJson, PartialProof)

    for (const [referent, attribute] of proof.requestedProof.revealedAttributes.entries()) {
      if (!IndyCredentialUtils.checkValidEncoding(attribute.raw, attribute.encoded)) {
        throw new PresentationProblemReportError(
          `The encoded value for '${referent}' is invalid. ` +
            `Expected '${IndyCredentialUtils.encode(attribute.raw)}'. ` +
            `Actual '${attribute.encoded}'`,
          { problemCode: PresentationProblemReportReason.Abandoned }
        )
      }
    }

    // TODO: pre verify proof json
    // I'm not 100% sure how much indy does. Also if it checks whether the proof requests matches the proof
    // @see https://github.com/hyperledger/aries-cloudagent-python/blob/master/aries_cloudagent/indy/sdk/verifier.py#L79-L164

    const schemas = await this.getSchemas(new Set(proof.identifiers.map((i) => i.schemaId)))
    const credentialDefinitions = await this.getCredentialDefinitions(
      new Set(proof.identifiers.map((i) => i.credentialDefinitionId))
    )

    return await this.indyVerifierService.verifyProof({
      proofRequest: proofRequest.toJSON(),
      proof: proofJson,
      schemas,
      credentialDefinitions,
    })
  }

  /**
   * Retrieve all proof records
   *
   * @returns List containing all proof records
   */
  public async getAll(): Promise<ProofRecord[]> {
    return this.proofRepository.getAll()
  }

  /**
   * Retrieve a proof record by id
   *
   * @param proofRecordId The proof record id
   * @throws {RecordNotFoundError} If no record is found
   * @return The proof record
   *
   */
  public async getById(proofRecordId: string): Promise<ProofRecord> {
    return this.proofRepository.getById(proofRecordId)
  }

  /**
   * Retrieve a proof record by id
   *
   * @param proofRecordId The proof record id
   * @return The proof record or null if not found
   *
   */
  public async findById(proofRecordId: string): Promise<ProofRecord | null> {
    return this.proofRepository.findById(proofRecordId)
  }

  /**
   * Delete a proof record by id
   *
   * @param proofId the proof record id
   */
  public async deleteById(proofId: string) {
    const proofRecord = await this.getById(proofId)
    return this.proofRepository.delete(proofRecord)
  }

  /**
   * Retrieve a proof record by connection id and thread id
   *
   * @param connectionId The connection id
   * @param threadId The thread id
   * @throws {RecordNotFoundError} If no record is found
   * @throws {RecordDuplicateError} If multiple records are found
   * @returns The proof record
   */
  public async getByThreadAndConnectionId(threadId: string, connectionId?: string): Promise<ProofRecord> {
    return this.proofRepository.getSingleByQuery({ threadId, connectionId })
  }

  public update(proofRecord: ProofRecord) {
    return this.proofRepository.update(proofRecord)
  }

  /**
   * Create indy proof from a given proof request and requested credential object.
   *
   * @param proofRequest The proof request to create the proof for
   * @param requestedCredentials The requested credentials object specifying which credentials to use for the proof
   * @returns indy proof object
   */
  private async createProof(
    proofRequest: ProofRequest,
    requestedCredentials: RequestedCredentials
  ): Promise<IndyProof> {
    const credentialObjects = await Promise.all(
      [
        ...Object.values(requestedCredentials.requestedAttributes),
        ...Object.values(requestedCredentials.requestedPredicates),
      ].map(async (c) => {
        if (c.credentialInfo) {
          return c.credentialInfo
        }
        const credentialInfo = await this.indyHolderService.getCredential(c.credentialId)
        return JsonTransformer.fromJSON(credentialInfo, IndyCredentialInfo)
      })
    )

    const schemas = await this.getSchemas(new Set(credentialObjects.map((c) => c.schemaId)))
    const credentialDefinitions = await this.getCredentialDefinitions(
      new Set(credentialObjects.map((c) => c.credentialDefinitionId))
    )

    return this.indyHolderService.createProof({
      proofRequest: proofRequest.toJSON(),
      requestedCredentials: requestedCredentials,
      schemas,
      credentialDefinitions,
    })
  }

  private async getCredentialsForProofRequest(
    proofRequest: ProofRequest,
    attributeReferent: string
  ): Promise<IndyCredential[]> {
    const credentialsJson = await this.indyHolderService.getCredentialsForProofRequest({
      proofRequest: proofRequest.toJSON(),
      attributeReferent,
    })

    return JsonTransformer.fromJSON(credentialsJson, IndyCredential) as unknown as IndyCredential[]
  }

  private async getRevocationStatusForRequestedItem({
    proofRequest,
    requestedItem,
    credential,
  }: {
    proofRequest: ProofRequest
    requestedItem: ProofAttributeInfo | ProofPredicateInfo
    credential: IndyCredential
  }) {
    const requestNonRevoked = requestedItem.nonRevoked ?? proofRequest.nonRevoked
    const credentialRevocationId = credential.credentialInfo.credentialRevocationId
    const revocationRegistryId = credential.credentialInfo.revocationRegistryId

    // If revocation interval is present and the credential is revocable then fetch the revocation status of credentials for display
    if (requestNonRevoked && credentialRevocationId && revocationRegistryId) {
      this.logger.trace(
        `Presentation is requesting proof of non revocation, getting revocation status for credential`,
        {
          requestNonRevoked,
          credentialRevocationId,
          revocationRegistryId,
        }
      )

      // Note presentation from-to's vs ledger from-to's: https://github.com/hyperledger/indy-hipe/blob/master/text/0011-cred-revocation/README.md#indy-node-revocation-registry-intervals
      const status = await this.indyRevocationService.getRevocationStatus(
        credentialRevocationId,
        revocationRegistryId,
        requestNonRevoked
      )

      return status
    }

    return { revoked: undefined, deltaTimestamp: undefined }
  }

  /**
   * Update the record to a new state and emit an state changed event. Also updates the record
   * in storage.
   *
   * @param proofRecord The proof record to update the state for
   * @param newState The state to update to
   *
   */
  private async updateState(proofRecord: ProofRecord, newState: ProofState) {
    const previousState = proofRecord.state
    proofRecord.state = newState
    await this.proofRepository.update(proofRecord)

    this.emitStateChangedEvent(proofRecord, previousState)
  }

  private emitStateChangedEvent(proofRecord: ProofRecord, previousState: ProofState | null) {
    const clonedProof = JsonTransformer.clone(proofRecord)

    this.eventEmitter.emit<ProofStateChangedEvent>({
      type: ProofEventTypes.ProofStateChanged,
      payload: {
        proofRecord: clonedProof,
        previousState: previousState,
      },
    })
  }

  /**
   * Build schemas object needed to create and verify proof objects.
   *
   * Creates object with `{ schemaId: Schema }` mapping
   *
   * @param schemaIds List of schema ids
   * @returns Object containing schemas for specified schema ids
   *
   */
  private async getSchemas(schemaIds: Set<string>) {
    const schemas: { [key: string]: Schema } = {}

    for (const schemaId of schemaIds) {
      const schema = await this.ledgerService.getSchema(schemaId)
      schemas[schemaId] = schema
    }

    return schemas
  }

  /**
   * Build credential definitions object needed to create and verify proof objects.
   *
   * Creates object with `{ credentialDefinitionId: CredentialDefinition }` mapping
   *
   * @param credentialDefinitionIds List of credential definition ids
   * @returns Object containing credential definitions for specified credential definition ids
   *
   */
  private async getCredentialDefinitions(credentialDefinitionIds: Set<string>) {
    const credentialDefinitions: { [key: string]: CredDef } = {}

    for (const credDefId of credentialDefinitionIds) {
      const credDef = await this.ledgerService.getCredentialDefinition(credDefId)
      credentialDefinitions[credDefId] = credDef
    }

    return credentialDefinitions
  }
}

export interface ProofRequestTemplate {
  proofRequest: ProofRequest
  comment?: string
}

export interface ProofProtocolMsgReturnType<MessageType extends AgentMessage> {
  message: MessageType
  proofRecord: ProofRecord
}
