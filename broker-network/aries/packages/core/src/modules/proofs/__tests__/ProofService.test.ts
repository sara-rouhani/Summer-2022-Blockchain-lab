import type { Wallet } from '../../../wallet/Wallet'
import type { CredentialRepository } from '../../credentials/repository'
import type { ProofStateChangedEvent } from '../ProofEvents'
import type { CustomProofTags } from './../repository/ProofRecord'

import { getAgentConfig, getMockConnection, mockFunction } from '../../../../tests/helpers'
import { EventEmitter } from '../../../agent/EventEmitter'
import { InboundMessageContext } from '../../../agent/models/InboundMessageContext'
import { Attachment, AttachmentData } from '../../../decorators/attachment/Attachment'
import { ConnectionService, DidExchangeState } from '../../connections'
import { IndyHolderService } from '../../indy/services/IndyHolderService'
import { IndyRevocationService } from '../../indy/services/IndyRevocationService'
import { IndyLedgerService } from '../../ledger/services'
import { ProofEventTypes } from '../ProofEvents'
import { ProofState } from '../ProofState'
import { PresentationProblemReportReason } from '../errors/PresentationProblemReportReason'
import { INDY_PROOF_REQUEST_ATTACHMENT_ID } from '../messages'
import { ProofRecord } from '../repository/ProofRecord'
import { ProofRepository } from '../repository/ProofRepository'
import { ProofService } from '../services'

import { IndyVerifierService } from './../../indy/services/IndyVerifierService'
import { PresentationProblemReportMessage } from './../messages/PresentationProblemReportMessage'
import { RequestPresentationMessage } from './../messages/RequestPresentationMessage'
import { credDef } from './fixtures'

// Mock classes
jest.mock('../repository/ProofRepository')
jest.mock('../../../modules/ledger/services/IndyLedgerService')
jest.mock('../../indy/services/IndyHolderService')
jest.mock('../../indy/services/IndyIssuerService')
jest.mock('../../indy/services/IndyVerifierService')
jest.mock('../../indy/services/IndyRevocationService')
jest.mock('../../connections/services/ConnectionService')

// Mock typed object
const ProofRepositoryMock = ProofRepository as jest.Mock<ProofRepository>
const IndyLedgerServiceMock = IndyLedgerService as jest.Mock<IndyLedgerService>
const IndyHolderServiceMock = IndyHolderService as jest.Mock<IndyHolderService>
const IndyVerifierServiceMock = IndyVerifierService as jest.Mock<IndyVerifierService>
const IndyRevocationServiceMock = IndyRevocationService as jest.Mock<IndyRevocationService>
const connectionServiceMock = ConnectionService as jest.Mock<ConnectionService>

const connection = getMockConnection({
  id: '123',
  state: DidExchangeState.Completed,
})

const requestAttachment = new Attachment({
  id: INDY_PROOF_REQUEST_ATTACHMENT_ID,
  mimeType: 'application/json',
  data: new AttachmentData({
    base64:
      'eyJuYW1lIjogIlByb29mIHJlcXVlc3QiLCAibm9uX3Jldm9rZWQiOiB7ImZyb20iOiAxNjQwOTk1MTk5LCAidG8iOiAxNjQwOTk1MTk5fSwgIm5vbmNlIjogIjEiLCAicmVxdWVzdGVkX2F0dHJpYnV0ZXMiOiB7ImFkZGl0aW9uYWxQcm9wMSI6IHsibmFtZSI6ICJmYXZvdXJpdGVEcmluayIsICJub25fcmV2b2tlZCI6IHsiZnJvbSI6IDE2NDA5OTUxOTksICJ0byI6IDE2NDA5OTUxOTl9LCAicmVzdHJpY3Rpb25zIjogW3siY3JlZF9kZWZfaWQiOiAiV2dXeHF6dHJOb29HOTJSWHZ4U1RXdjozOkNMOjIwOnRhZyJ9XX19LCAicmVxdWVzdGVkX3ByZWRpY2F0ZXMiOiB7fSwgInZlcnNpb24iOiAiMS4wIn0=',
  }),
})

// A record is deserialized to JSON when it's stored into the storage. We want to simulate this behaviour for `offer`
// object to test our service would behave correctly. We use type assertion for `offer` attribute to `any`.
const mockProofRecord = ({
  state,
  requestMessage,
  threadId,
  connectionId,
  tags,
  id,
}: {
  state?: ProofState
  requestMessage?: RequestPresentationMessage
  tags?: CustomProofTags
  threadId?: string
  connectionId?: string
  id?: string
} = {}) => {
  const requestPresentationMessage = new RequestPresentationMessage({
    comment: 'some comment',
    requestPresentationAttachments: [requestAttachment],
  })

  const proofRecord = new ProofRecord({
    requestMessage,
    id,
    state: state || ProofState.RequestSent,
    threadId: threadId ?? requestPresentationMessage.id,
    connectionId: connectionId ?? '123',
    tags,
  })

  return proofRecord
}

describe('ProofService', () => {
  let proofRepository: ProofRepository
  let proofService: ProofService
  let ledgerService: IndyLedgerService
  let wallet: Wallet
  let indyVerifierService: IndyVerifierService
  let indyHolderService: IndyHolderService
  let indyRevocationService: IndyRevocationService
  let eventEmitter: EventEmitter
  let credentialRepository: CredentialRepository
  let connectionService: ConnectionService

  beforeEach(() => {
    const agentConfig = getAgentConfig('ProofServiceTest')
    proofRepository = new ProofRepositoryMock()
    indyVerifierService = new IndyVerifierServiceMock()
    indyHolderService = new IndyHolderServiceMock()
    indyRevocationService = new IndyRevocationServiceMock()
    ledgerService = new IndyLedgerServiceMock()
    eventEmitter = new EventEmitter(agentConfig)
    connectionService = new connectionServiceMock()

    proofService = new ProofService(
      proofRepository,
      ledgerService,
      wallet,
      agentConfig,
      indyHolderService,
      indyVerifierService,
      indyRevocationService,
      connectionService,
      eventEmitter,
      credentialRepository
    )

    mockFunction(ledgerService.getCredentialDefinition).mockReturnValue(Promise.resolve(credDef))
  })

  describe('processProofRequest', () => {
    let presentationRequest: RequestPresentationMessage
    let messageContext: InboundMessageContext<RequestPresentationMessage>

    beforeEach(() => {
      presentationRequest = new RequestPresentationMessage({
        comment: 'abcd',
        requestPresentationAttachments: [requestAttachment],
      })
      messageContext = new InboundMessageContext(presentationRequest, {
        connection,
      })
    })

    test(`creates and return proof record in ${ProofState.PresentationReceived} state with offer, without thread ID`, async () => {
      const repositorySaveSpy = jest.spyOn(proofRepository, 'save')

      // when
      const returnedProofRecord = await proofService.processRequest(messageContext)

      // then
      const expectedProofRecord = {
        type: ProofRecord.name,
        id: expect.any(String),
        createdAt: expect.any(Date),
        state: ProofState.RequestReceived,
        threadId: presentationRequest.id,
        connectionId: connection.id,
      }
      expect(repositorySaveSpy).toHaveBeenCalledTimes(1)
      const [[createdProofRecord]] = repositorySaveSpy.mock.calls
      expect(createdProofRecord).toMatchObject(expectedProofRecord)
      expect(returnedProofRecord).toMatchObject(expectedProofRecord)
    })

    test(`emits stateChange event with ${ProofState.RequestReceived}`, async () => {
      const eventListenerMock = jest.fn()
      eventEmitter.on<ProofStateChangedEvent>(ProofEventTypes.ProofStateChanged, eventListenerMock)

      // when
      await proofService.processRequest(messageContext)

      // then
      expect(eventListenerMock).toHaveBeenCalledWith({
        type: 'ProofStateChanged',
        payload: {
          previousState: null,
          proofRecord: expect.objectContaining({
            state: ProofState.RequestReceived,
          }),
        },
      })
    })
  })

  describe('createProblemReport', () => {
    const threadId = 'fd9c5ddb-ec11-4acd-bc32-540736249746'
    let proof: ProofRecord

    beforeEach(() => {
      proof = mockProofRecord({
        state: ProofState.RequestReceived,
        threadId,
        connectionId: 'b1e2f039-aa39-40be-8643-6ce2797b5190',
      })
    })

    test('returns problem report message base once get error', async () => {
      // given
      mockFunction(proofRepository.getById).mockReturnValue(Promise.resolve(proof))

      // when
      const presentationProblemReportMessage = await new PresentationProblemReportMessage({
        description: {
          en: 'Indy error',
          code: PresentationProblemReportReason.Abandoned,
        },
      })

      presentationProblemReportMessage.setThread({ threadId })
      // then
      expect(presentationProblemReportMessage.toJSON()).toMatchObject({
        '@id': expect.any(String),
        '@type': 'https://didcomm.org/present-proof/1.0/problem-report',
        '~thread': {
          thid: 'fd9c5ddb-ec11-4acd-bc32-540736249746',
        },
      })
    })
  })

  describe('processProblemReport', () => {
    let proof: ProofRecord
    let messageContext: InboundMessageContext<PresentationProblemReportMessage>

    beforeEach(() => {
      proof = mockProofRecord({
        state: ProofState.RequestReceived,
      })

      const presentationProblemReportMessage = new PresentationProblemReportMessage({
        description: {
          en: 'Indy error',
          code: PresentationProblemReportReason.Abandoned,
        },
      })
      presentationProblemReportMessage.setThread({ threadId: 'somethreadid' })
      messageContext = new InboundMessageContext(presentationProblemReportMessage, {
        connection,
      })
    })

    test(`updates problem report error message and returns proof record`, async () => {
      const repositoryUpdateSpy = jest.spyOn(proofRepository, 'update')

      // given
      mockFunction(proofRepository.getSingleByQuery).mockReturnValue(Promise.resolve(proof))

      // when
      const returnedCredentialRecord = await proofService.processProblemReport(messageContext)

      // then
      const expectedCredentialRecord = {
        errorMessage: 'abandoned: Indy error',
      }
      expect(proofRepository.getSingleByQuery).toHaveBeenNthCalledWith(1, {
        threadId: 'somethreadid',
        connectionId: connection.id,
      })
      expect(repositoryUpdateSpy).toHaveBeenCalledTimes(1)
      const [[updatedCredentialRecord]] = repositoryUpdateSpy.mock.calls
      expect(updatedCredentialRecord).toMatchObject(expectedCredentialRecord)
      expect(returnedCredentialRecord).toMatchObject(expectedCredentialRecord)
    })
  })
})
