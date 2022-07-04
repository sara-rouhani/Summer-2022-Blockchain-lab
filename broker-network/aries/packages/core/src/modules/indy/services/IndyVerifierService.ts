import type * as Indy from 'indy-sdk'

import { Lifecycle, scoped } from 'tsyringe'

import { AgentConfig } from '../../../agent/AgentConfig'
import { IndySdkError } from '../../../error'
import { isIndyError } from '../../../utils/indyError'
import { IndyLedgerService } from '../../ledger/services/IndyLedgerService'

@scoped(Lifecycle.ContainerScoped)
export class IndyVerifierService {
  private indy: typeof Indy
  private ledgerService: IndyLedgerService

  public constructor(agentConfig: AgentConfig, ledgerService: IndyLedgerService) {
    this.indy = agentConfig.agentDependencies.indy
    this.ledgerService = ledgerService
  }

  public async verifyProof({
    proofRequest,
    proof,
    schemas,
    credentialDefinitions,
  }: VerifyProofOptions): Promise<boolean> {
    try {
      const { revocationRegistryDefinitions, revocationRegistryStates } = await this.getRevocationRegistries(proof)

      return await this.indy.verifierVerifyProof(
        proofRequest,
        proof,
        schemas,
        credentialDefinitions,
        revocationRegistryDefinitions,
        revocationRegistryStates
      )
    } catch (error) {
      throw isIndyError(error) ? new IndySdkError(error) : error
    }
  }

  private async getRevocationRegistries(proof: Indy.IndyProof) {
    const revocationRegistryDefinitions: Indy.RevocRegDefs = {}
    const revocationRegistryStates: Indy.RevStates = Object.create(null)
    for (const identifier of proof.identifiers) {
      const revocationRegistryId = identifier.rev_reg_id
      const timestamp = identifier.timestamp

      //Fetch Revocation Registry Definition if not already fetched
      if (revocationRegistryId && !revocationRegistryDefinitions[revocationRegistryId]) {
        const { revocationRegistryDefinition } = await this.ledgerService.getRevocationRegistryDefinition(
          revocationRegistryId
        )
        revocationRegistryDefinitions[revocationRegistryId] = revocationRegistryDefinition
      }

      //Fetch Revocation Registry by Timestamp if not already fetched
      if (revocationRegistryId && timestamp && !revocationRegistryStates[revocationRegistryId]?.[timestamp]) {
        if (!revocationRegistryStates[revocationRegistryId]) {
          revocationRegistryStates[revocationRegistryId] = Object.create(null)
        }
        const { revocationRegistry } = await this.ledgerService.getRevocationRegistry(revocationRegistryId, timestamp)
        revocationRegistryStates[revocationRegistryId][timestamp] = revocationRegistry
      }
    }
    return { revocationRegistryDefinitions, revocationRegistryStates }
  }
}

export interface VerifyProofOptions {
  proofRequest: Indy.IndyProofRequest
  proof: Indy.IndyProof
  schemas: Indy.Schemas
  credentialDefinitions: Indy.CredentialDefs
}
