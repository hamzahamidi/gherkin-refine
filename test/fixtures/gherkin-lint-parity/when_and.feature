Feature: When and And
  Scenario: one action continued with And
    Given a cart
    When I pay
    And I confirm
    Then the order exists
