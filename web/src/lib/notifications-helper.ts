import { createNotification, fetchUsers, type AppUser } from "./api"

// Cache users for the session to avoid repeated fetches
let cachedUsers: AppUser[] | null = null
let cacheTimestamp = 0
const CACHE_TTL = 60_000 // 1 minute

async function getUsers(): Promise<AppUser[]> {
    if (cachedUsers && Date.now() - cacheTimestamp < CACHE_TTL) return cachedUsers
    try {
        cachedUsers = await fetchUsers()
        cacheTimestamp = Date.now()
    } catch {
        cachedUsers = []
    }
    return cachedUsers
}

function getUsersByRole(users: AppUser[], role: string, team?: string): AppUser[] {
    return users.filter(u => {
        if (u.role !== role) return false
        if (team && u.team !== team) return false
        return true
    })
}

/** Send a notification to all users matching a role (and optionally a team). Fire-and-forget. */
async function notifyByRole(
    role: string,
    type: string,
    message: string,
    opts?: { team?: string; actionableId?: string; docId?: string }
): Promise<void> {
    try {
        const users = await getUsers()
        const targets = getUsersByRole(users, role, opts?.team)
        await Promise.all(targets.map(u =>
            u.id ? createNotification({
                user_id: u.id,
                type,
                message,
                actionable_id: opts?.actionableId,
                doc_id: opts?.docId,
            }).catch(() => {}) : Promise.resolve()
        ))
    } catch {
        // Notifications are best-effort — never block the main flow
    }
}

/** Send a notification to a specific user by ID. Fire-and-forget. */
async function notifyUser(
    userId: string,
    type: string,
    message: string,
    opts?: { actionableId?: string; docId?: string }
): Promise<void> {
    try {
        await createNotification({
            user_id: userId,
            type,
            message,
            actionable_id: opts?.actionableId,
            doc_id: opts?.docId,
        })
    } catch {
        // Best-effort
    }
}

// ─── Workflow Notification Functions ─────────────────────────────────────────

/** 1. Actionable published → notify assigned team members (Makers) */
export async function notifyPublished(
    actionableTitle: string,
    team: string,
    docId: string,
    actionableId: string
): Promise<void> {
    await notifyByRole("team_member", "publish",
        `New actionable assigned to ${team}: "${actionableTitle.slice(0, 80)}"`,
        { team, actionableId, docId }
    )
    // Also notify the team reviewer
    await notifyByRole("team_reviewer", "publish",
        `New actionable published for ${team}: "${actionableTitle.slice(0, 80)}"`,
        { team, actionableId, docId }
    )
}

/** 2. Maker submits for team review → notify Checker */
export async function notifySubmittedForReview(
    actionableTitle: string,
    team: string,
    submitterName: string,
    docId: string,
    actionableId: string
): Promise<void> {
    await notifyByRole("team_reviewer", "info",
        `${submitterName} submitted "${actionableTitle.slice(0, 60)}" for review (${team})`,
        { team, actionableId, docId }
    )
}

/** 3. Checker approves → forwards to CO review → notify CAG */
export async function notifyForwardedToCO(
    actionableTitle: string,
    team: string,
    reviewerName: string,
    docId: string,
    actionableId: string
): Promise<void> {
    await notifyByRole("compliance_officer", "info",
        `${reviewerName} approved "${actionableTitle.slice(0, 60)}" — ready for compliance review`,
        { actionableId, docId }
    )
}

/** 4. Checker rejects → notify Maker */
export async function notifyCheckerRejected(
    actionableTitle: string,
    team: string,
    reason: string,
    docId: string,
    actionableId: string
): Promise<void> {
    await notifyByRole("team_member", "rejection",
        `Checker rejected "${actionableTitle.slice(0, 60)}": ${reason.slice(0, 100)}`,
        { team, actionableId, docId }
    )
}

/** 5. CAG approves (completed) → notify Maker, Checker, Lead */
export async function notifyCAGApproved(
    actionableTitle: string,
    team: string,
    docId: string,
    actionableId: string
): Promise<void> {
    const msg = `Actionable completed: "${actionableTitle.slice(0, 60)}" approved by Compliance Officer`
    await Promise.all([
        notifyByRole("team_member", "approval", msg, { team, actionableId, docId }),
        notifyByRole("team_reviewer", "approval", msg, { team, actionableId, docId }),
        notifyByRole("team_lead", "approval", msg, { team, actionableId, docId }),
    ])
}

/** 6. CAG rejects (reworking) → notify Maker and Checker */
export async function notifyCAGRejected(
    actionableTitle: string,
    team: string,
    reason: string,
    docId: string,
    actionableId: string
): Promise<void> {
    const msg = `Compliance Officer rejected "${actionableTitle.slice(0, 60)}": ${reason.slice(0, 100)}`
    await Promise.all([
        notifyByRole("team_member", "rejection", msg, { team, actionableId, docId }),
        notifyByRole("team_reviewer", "rejection", msg, { team, actionableId, docId }),
    ])
}

/** 7. Actionable unpublished/reset → notify Maker and Checker */
export async function notifyUnpublished(
    actionableTitle: string,
    team: string,
    docId: string,
    actionableId: string
): Promise<void> {
    const msg = `Actionable unpublished: "${actionableTitle.slice(0, 60)}" returned to Actionables`
    await Promise.all([
        notifyByRole("team_member", "info", msg, { team, actionableId, docId }),
        notifyByRole("team_reviewer", "info", msg, { team, actionableId, docId }),
    ])
}

/** 8. Wrongly tagged flag raised by Maker → notify Checker */
export async function notifyWronglyTagged(
    actionableTitle: string,
    team: string,
    memberName: string,
    docId: string,
    actionableId: string
): Promise<void> {
    await notifyByRole("team_reviewer", "rework",
        `${memberName} flagged "${actionableTitle.slice(0, 60)}" as wrongly tagged — review required`,
        { team, actionableId, docId }
    )
}

/** 9. Checker approves wrongly-tagged → notify CAG */
export async function notifyBypassApprovedByChecker(
    actionableTitle: string,
    reviewerName: string,
    docId: string,
    actionableId: string
): Promise<void> {
    await notifyByRole("compliance_officer", "rework",
        `${reviewerName} approved wrongly-tagged flag for "${actionableTitle.slice(0, 60)}" — CO decision required`,
        { actionableId, docId }
    )
}

/** 10. CAG approves wrongly-tagged (full reset) → notify all */
export async function notifyBypassFullReset(
    actionableTitle: string,
    team: string,
    docId: string,
    actionableId: string
): Promise<void> {
    const msg = `Wrongly-tagged approved: "${actionableTitle.slice(0, 60)}" returned to Actionables`
    await Promise.all([
        notifyByRole("team_member", "info", msg, { team, actionableId, docId }),
        notifyByRole("team_reviewer", "info", msg, { team, actionableId, docId }),
        notifyByRole("team_lead", "info", msg, { team, actionableId, docId }),
    ])
}

/** 11. CAG disapproves wrongly-tagged → notify Maker */
export async function notifyBypassDisapproved(
    actionableTitle: string,
    team: string,
    reason: string,
    docId: string,
    actionableId: string
): Promise<void> {
    await notifyByRole("team_member", "rejection",
        `Wrongly-tagged flag disapproved for "${actionableTitle.slice(0, 60)}": ${reason.slice(0, 100)}`,
        { team, actionableId, docId }
    )
}

/** 12. Delay justification submitted by Maker → notify Checker */
export async function notifyDelayJustificationSubmitted(
    actionableTitle: string,
    team: string,
    memberName: string,
    docId: string,
    actionableId: string
): Promise<void> {
    await notifyByRole("team_reviewer", "info",
        `${memberName} submitted delay justification for "${actionableTitle.slice(0, 60)}" — approval needed`,
        { team, actionableId, docId }
    )
}

/** 13. Delay justification approved by Checker → notify Lead */
export async function notifyDelayJustificationReviewerApproved(
    actionableTitle: string,
    team: string,
    docId: string,
    actionableId: string
): Promise<void> {
    await notifyByRole("team_lead", "info",
        `Delay justification approved by Checker for "${actionableTitle.slice(0, 60)}" — Lead approval needed`,
        { team, actionableId, docId }
    )
}

/** 14. Delay justification approved by Lead → notify CAG */
export async function notifyDelayJustificationLeadApproved(
    actionableTitle: string,
    team: string,
    docId: string,
    actionableId: string
): Promise<void> {
    await notifyByRole("compliance_officer", "info",
        `Delay justification fully approved for "${actionableTitle.slice(0, 60)}" (${team})`,
        { actionableId, docId }
    )
}

/** 15. Checker rejects Maker (team_review → reviewer_rejected) → notify Maker */
export async function notifyCheckerRejectedToMaker(
    actionableTitle: string,
    team: string,
    reason: string,
    docId: string,
    actionableId: string
): Promise<void> {
    await notifyByRole("team_member", "rejection",
        `Checker returned "${actionableTitle.slice(0, 60)}" for rework: ${reason.slice(0, 100)}`,
        { team, actionableId, docId }
    )
}
