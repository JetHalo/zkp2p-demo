fn pow7(x: Field) -> Field {
    // x^7 with minimal multiplications.
    let x2 = x * x;
    let x4 = x2 * x2;
    x4 * x2 * x
}

fn mimc7_round(state: Field, key: Field, constant: Field) -> Field {
    let t = state + key + constant;
    pow7(t)
}

fn mimc7_permute(input: Field, key: Field) -> Field {
    let mut state = input;
    // Fixed rounds keep proving deterministic and easy to port in TS.
    for i in 0..91 {
        let c = (i + 1) as Field;
        state = mimc7_round(state, key, c);
    }
    state + key
}

fn mimc7_hash2(left: Field, right: Field) -> Field {
    mimc7_permute(left, right) + right
}

fn compute_statement(
    business_domain: Field,
    app_id: Field,
    user_addr: Field,
    chain_id: Field,
    timestamp: Field,
    intent_id: Field,
    amount: Field,
) -> Field {
    // Ordered folding contract:
    // intent_id -> user_addr -> amount -> chain_id -> timestamp -> business_domain -> app_id
    let mut acc = mimc7_hash2(intent_id, user_addr);
    acc = mimc7_hash2(acc, amount);
    acc = mimc7_hash2(acc, chain_id);
    acc = mimc7_hash2(acc, timestamp);
    acc = mimc7_hash2(acc, business_domain);
    mimc7_hash2(acc, app_id)
}

fn compute_nullifier(secret: Field, intent_id: Field) -> Field {
    mimc7_hash2(secret, intent_id)
}

fn compute_wise_witness_hash(
    amount: Field,
    timestamp: Field,
    user_addr: Field,
    wise_receipt_hash: Field,
    secret: Field,
) -> Field {
    let payment_commitment = mimc7_hash2(amount, timestamp);
    let payer_commitment = mimc7_hash2(payment_commitment, user_addr);
    let receipt_commitment = mimc7_hash2(payer_commitment, wise_receipt_hash);
    mimc7_hash2(receipt_commitment, secret)
}

fn assert_non_zero_public(
    business_domain: Field,
    app_id: Field,
    user_addr: Field,
    chain_id: Field,
    timestamp: Field,
    intent_id: Field,
    amount: Field,
    wise_receipt_hash: Field,
    nullifier: Field,
    statement: Field,
) {
    assert(business_domain != 0);
    assert(app_id != 0);
    assert(user_addr != 0);
    assert(chain_id != 0);
    assert(timestamp != 0);
    assert(intent_id != 0);
    assert(amount != 0);
    assert(wise_receipt_hash != 0);
    assert(nullifier != 0);
    assert(statement != 0);
}

fn main(
    business_domain: pub Field,
    app_id: pub Field,
    user_addr: pub Field,
    chain_id: pub Field,
    timestamp: pub Field,
    intent_id: pub Field,
    amount: pub Field,
    wise_receipt_hash: pub Field,
    nullifier: pub Field,
    statement: pub Field,
    secret: Field,
    wise_witness_hash: Field,
) {
    assert_non_zero_public(
        business_domain,
        app_id,
        user_addr,
        chain_id,
        timestamp,
        intent_id,
        amount,
        wise_receipt_hash,
        nullifier,
        statement,
    );
    assert(secret != 0);
    assert(wise_witness_hash != 0);

    let expected_statement = compute_statement(
        business_domain,
        app_id,
        user_addr,
        chain_id,
        timestamp,
        intent_id,
        amount,
    );
    assert(statement == expected_statement);

    let expected_nullifier = compute_nullifier(secret, intent_id);
    assert(nullifier == expected_nullifier);

    let expected_wise_witness_hash =
        compute_wise_witness_hash(amount, timestamp, user_addr, wise_receipt_hash, secret);
    assert(wise_witness_hash == expected_wise_witness_hash);
}

#[test]
fn valid_witness_passes() {
    let business_domain = 101;
    let app_id = 202;
    let user_addr = 303;
    let chain_id = 7332;
    let timestamp = 1739102400;
    let intent_id = 404;
    let amount = 100000000;
    let wise_receipt_hash = 707;
    let secret = 505;
    let nullifier = compute_nullifier(secret, intent_id);
    let statement = compute_statement(
        business_domain,
        app_id,
        user_addr,
        chain_id,
        timestamp,
        intent_id,
        amount,
    );
    let wise_witness_hash =
        compute_wise_witness_hash(amount, timestamp, user_addr, wise_receipt_hash, secret);

    main(
        business_domain,
        app_id,
        user_addr,
        chain_id,
        timestamp,
        intent_id,
        amount,
        wise_receipt_hash,
        nullifier,
        statement,
        secret,
        wise_witness_hash,
    );
}

#[test(should_fail)]
fn wrong_statement_fails() {
    let business_domain = 101;
    let app_id = 202;
    let user_addr = 303;
    let chain_id = 7332;
    let timestamp = 1739102400;
    let intent_id = 404;
    let amount = 100000000;
    let wise_receipt_hash = 707;
    let secret = 505;
    let nullifier = compute_nullifier(secret, intent_id);
    let wise_witness_hash =
        compute_wise_witness_hash(amount, timestamp, user_addr, wise_receipt_hash, secret);

    main(
        business_domain,
        app_id,
        user_addr,
        chain_id,
        timestamp,
        intent_id,
        amount,
        wise_receipt_hash,
        nullifier,
        1, // invalid statement
        secret,
        wise_witness_hash,
    );
}

#[test(should_fail)]
fn payer_mismatch_must_fail() {
    let business_domain = 101;
    let app_id = 202;
    let chain_id = 7332;
    let timestamp = 1739102400;
    let intent_id = 404;
    let amount = 100000000;
    let wise_receipt_hash = 707;
    let secret = 505;
    let payer_addr = 303;
    let spoofed_addr = 909;

    let wise_witness_hash =
        compute_wise_witness_hash(amount, timestamp, payer_addr, wise_receipt_hash, secret);
    let nullifier = compute_nullifier(secret, intent_id);
    let statement = compute_statement(
        business_domain,
        app_id,
        spoofed_addr,
        chain_id,
        timestamp,
        intent_id,
        amount,
    );

    // Expected behavior: this should fail because payer used in statement/public input
    // must match payer bound in witness relation.
    main(
        business_domain,
        app_id,
        spoofed_addr,
        chain_id,
        timestamp,
        intent_id,
        amount,
        wise_receipt_hash,
        nullifier,
        statement,
        secret,
        wise_witness_hash,
    );
}

#[test(should_fail)]
fn receipt_hash_mismatch_must_fail() {
    let business_domain = 101;
    let app_id = 202;
    let user_addr = 303;
    let chain_id = 7332;
    let timestamp = 1739102400;
    let intent_id = 404;
    let amount = 100000000;
    let wise_receipt_hash = 707;
    let spoofed_receipt_hash = 808;
    let secret = 505;
    let nullifier = compute_nullifier(secret, intent_id);
    let statement = compute_statement(
        business_domain,
        app_id,
        user_addr,
        chain_id,
        timestamp,
        intent_id,
        amount,
    );
    let wise_witness_hash =
        compute_wise_witness_hash(amount, timestamp, user_addr, wise_receipt_hash, secret);

    main(
        business_domain,
        app_id,
        user_addr,
        chain_id,
        timestamp,
        intent_id,
        amount,
        spoofed_receipt_hash,
        nullifier,
        statement,
        secret,
        wise_witness_hash,
    );
}
