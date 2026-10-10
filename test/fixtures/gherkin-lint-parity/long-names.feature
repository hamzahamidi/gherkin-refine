Feature: Long names are checked against every configured limit for gherkin-lint
  Scenario: A scenario name that is clearly longer than forty characters
    Given a step text that is long enough to pass the fifty character limit
  Scenario: one
    Given x
